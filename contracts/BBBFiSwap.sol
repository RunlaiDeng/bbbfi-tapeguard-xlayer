// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IBBBFiWrappedXDC is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IBBBFiSwapPair is IERC20 {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function mint(address to) external returns (uint256 liquidity);
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    function swap(uint256 amount0Out, uint256 amount1Out, address to) external;
}

interface IBBBFiSwapFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

/**
 * Wrapped native XDC used by BBBFiSwap pools. There is no owner, fee, pause,
 * proxy, or upgrade mechanism. One WBBBXDC is always redeemable for one XDC.
 */
contract BBBFiWrappedXDC is ERC20, ReentrancyGuard {
    constructor() ERC20("BBBFi Wrapped XDC", "WBBBXDC") {}

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        require(msg.value != 0, "zero deposit");
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount != 0, "zero withdrawal");
        _burn(msg.sender, amount);
        (bool success,) = payable(msg.sender).call{value: amount}("");
        require(success, "XDC transfer failed");
    }
}

/**
 * Constant-product liquidity pair with a fixed 0.30% swap fee paid to LPs.
 * LP tokens represent a pro-rata claim on both reserves. The contract has no
 * owner or administrative withdrawal path.
 */
contract BBBFiSwapPair is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MINIMUM_LIQUIDITY = 1_000;
    address public constant MINIMUM_LIQUIDITY_LOCK = 0x000000000000000000000000000000000000dEaD;

    address public immutable factory;
    address public immutable token0;
    address public immutable token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    event Mint(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);

    constructor(address pairToken0, address pairToken1) ERC20("BBBFiSwap LP Token", "BBBFI-LP") {
        require(pairToken0 != address(0) && pairToken0 < pairToken1, "invalid token order");
        factory = msg.sender;
        token0 = pairToken0;
        token1 = pairToken1;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    function mint(address to) external nonReentrant returns (uint256 liquidity) {
        require(to != address(0), "zero recipient");
        (uint112 cachedReserve0, uint112 cachedReserve1,) = this.getReserves();
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0 = balance0 - cachedReserve0;
        uint256 amount1 = balance1 - cachedReserve1;
        uint256 supply = totalSupply();

        if (supply == 0) {
            uint256 rootK = Math.sqrt(amount0 * amount1);
            require(rootK > MINIMUM_LIQUIDITY, "insufficient initial liquidity");
            liquidity = rootK - MINIMUM_LIQUIDITY;
            _mint(MINIMUM_LIQUIDITY_LOCK, MINIMUM_LIQUIDITY);
        } else {
            liquidity = Math.min(amount0 * supply / cachedReserve0, amount1 * supply / cachedReserve1);
        }
        require(liquidity != 0, "insufficient liquidity minted");
        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1, to);
    }

    function burn(address to) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        require(to != address(0) && to != token0 && to != token1, "invalid recipient");
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 liquidity = balanceOf(address(this));
        uint256 supply = totalSupply();
        amount0 = liquidity * balance0 / supply;
        amount1 = liquidity * balance1 / supply;
        require(amount0 != 0 && amount1 != 0, "insufficient liquidity burned");

        _burn(address(this), liquidity);
        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);
        balance0 = IERC20(token0).balanceOf(address(this));
        balance1 = IERC20(token1).balanceOf(address(this));
        _update(balance0, balance1);
        emit Burn(msg.sender, amount0, amount1, to);
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to) external nonReentrant {
        require(amount0Out != 0 || amount1Out != 0, "insufficient output");
        (uint112 cachedReserve0, uint112 cachedReserve1,) = this.getReserves();
        require(amount0Out < cachedReserve0 && amount1Out < cachedReserve1, "insufficient liquidity");
        require(to != address(0) && to != token0 && to != token1, "invalid recipient");

        if (amount0Out != 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out != 0) IERC20(token1).safeTransfer(to, amount1Out);
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In =
            balance0 > cachedReserve0 - amount0Out ? balance0 - (cachedReserve0 - amount0Out) : 0;
        uint256 amount1In =
            balance1 > cachedReserve1 - amount1Out ? balance1 - (cachedReserve1 - amount1Out) : 0;
        require(amount0In != 0 || amount1In != 0, "insufficient input");

        uint256 adjusted0 = balance0 * 1_000 - amount0In * 3;
        uint256 adjusted1 = balance1 * 1_000 - amount1In * 3;
        require(
            adjusted0 * adjusted1 >= uint256(cachedReserve0) * cachedReserve1 * 1_000_000, "constant product"
        );
        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /**
     * Move accidental excess token balances without touching recorded reserves.
     */
    function skim(address to) external nonReentrant {
        require(to != address(0), "zero recipient");
        IERC20(token0).safeTransfer(to, IERC20(token0).balanceOf(address(this)) - reserve0);
        IERC20(token1).safeTransfer(to, IERC20(token1).balanceOf(address(this)) - reserve1);
    }

    /**
     * Reconcile recorded reserves with actual balances after a direct token transfer.
     */
    function sync() external nonReentrant {
        _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function _update(uint256 balance0, uint256 balance1) private {
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "reserve overflow");
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = uint32(block.timestamp);
        emit Sync(reserve0, reserve1);
    }
}

/**
 * Permissionless BBBFiSwap pair registry. Any address may create a pair, and
 * neither the factory nor its pairs have an owner or upgrade authority.
 */
contract BBBFiSwapFactory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairCount);

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) public returns (address pair) {
        require(tokenA != tokenB, "identical tokens");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "zero token");
        require(token0.code.length != 0 && token1.code.length != 0, "token is not contract");
        require(getPair[token0][token1] == address(0), "pair exists");

        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        pair = address(new BBBFiSwapPair{salt: salt}(token0, token1));
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    function predictPair(address tokenA, address tokenB) external view returns (address predicted) {
        require(tokenA != tokenB, "identical tokens");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(BBBFiSwapPair).creationCode, abi.encode(token0, token1)));
        predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))))
        );
    }
}

/**
 * Stateless BBBFiSwap router. Users retain custody and sign their own approval,
 * liquidity, and swap transactions. Slippage limits and deadlines are required.
 */
contract BBBFiSwapRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable factory;
    address public immutable wrappedXDC;

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "expired");
        _;
    }

    constructor(address factoryAddress, address wrappedXDCAddress) {
        require(factoryAddress.code.length != 0 && wrappedXDCAddress.code.length != 0, "invalid contract");
        factory = factoryAddress;
        wrappedXDC = wrappedXDCAddress;
    }

    receive() external payable {
        require(msg.sender == wrappedXDC, "direct XDC rejected");
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        address pair;
        (amountA, amountB, pair) =
            _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        IERC20(tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, pair, amountB);
        liquidity = IBBBFiSwapPair(pair).mint(to);
    }

    function addLiquidityXDC(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountXDCMin,
        address to,
        uint256 deadline
    )
        external
        payable
        nonReentrant
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountXDC, uint256 liquidity)
    {
        address pair;
        (amountToken, amountXDC, pair) =
            _addLiquidity(token, wrappedXDC, amountTokenDesired, msg.value, amountTokenMin, amountXDCMin);
        IERC20(token).safeTransferFrom(msg.sender, pair, amountToken);
        IBBBFiWrappedXDC(wrappedXDC).deposit{value: amountXDC}();
        IERC20(wrappedXDC).safeTransfer(pair, amountXDC);
        liquidity = IBBBFiSwapPair(pair).mint(to);
        if (msg.value > amountXDC) _safeTransferXDC(msg.sender, msg.value - amountXDC);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) public nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = _pairFor(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IBBBFiSwapPair(pair).burn(to);
        (address token0,) = _sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin && amountB >= amountBMin, "insufficient withdrawn amount");
    }

    function removeLiquidityXDC(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountXDCMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountToken, uint256 amountXDC) {
        address pair = _pairFor(token, wrappedXDC);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IBBBFiSwapPair(pair).burn(address(this));
        (address token0,) = _sortTokens(token, wrappedXDC);
        (amountToken, amountXDC) = token == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountToken >= amountTokenMin && amountXDC >= amountXDCMin, "insufficient withdrawn amount");
        IERC20(token).safeTransfer(to, amountToken);
        IBBBFiWrappedXDC(wrappedXDC).withdraw(amountXDC);
        _safeTransferXDC(to, amountXDC);
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        amounts = getAmountsOut(amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "insufficient output amount");
        IERC20(path[0]).safeTransferFrom(msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactXDCForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2 && path[0] == wrappedXDC, "invalid XDC path");
        amounts = getAmountsOut(msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "insufficient output amount");
        IBBBFiWrappedXDC(wrappedXDC).deposit{value: amounts[0]}();
        IERC20(wrappedXDC).safeTransfer(_pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactTokensForXDC(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2 && path[path.length - 1] == wrappedXDC, "invalid XDC path");
        amounts = getAmountsOut(amountIn, path);
        uint256 amountOut = amounts[amounts.length - 1];
        require(amountOut >= amountOutMin, "insufficient output amount");
        IERC20(path[0]).safeTransferFrom(msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IBBBFiWrappedXDC(wrappedXDC).withdraw(amountOut);
        _safeTransferXDC(to, amountOut);
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        public
        pure
        returns (uint256 amountB)
    {
        require(amountA != 0, "insufficient amount");
        require(reserveA != 0 && reserveB != 0, "insufficient liquidity");
        amountB = amountA * reserveB / reserveA;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        public
        pure
        returns (uint256 amountOut)
    {
        require(amountIn != 0, "insufficient input");
        require(reserveIn != 0 && reserveOut != 0, "insufficient liquidity");
        uint256 amountInWithFee = amountIn * 997;
        amountOut = amountInWithFee * reserveOut / (reserveIn * 1_000 + amountInWithFee);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        public
        view
        returns (uint256[] memory amounts)
    {
        require(path.length >= 2, "invalid path");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; ++i) {
            (uint256 reserveIn, uint256 reserveOut) = _getReserves(path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) private returns (uint256 amountA, uint256 amountB, address pair) {
        require(amountADesired != 0 && amountBDesired != 0, "zero desired amount");
        pair = IBBBFiSwapFactory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) pair = IBBBFiSwapFactory(factory).createPair(tokenA, tokenB);
        (uint256 reserveA, uint256 reserveB) = _getReserves(tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, "insufficient token B amount");
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = quote(amountBDesired, reserveB, reserveA);
                require(
                    amountAOptimal <= amountADesired && amountAOptimal >= amountAMin,
                    "insufficient token A amount"
                );
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
        require(amountA >= amountAMin && amountB >= amountBMin, "slippage exceeded");
    }

    function _swap(uint256[] memory amounts, address[] calldata path, address finalRecipient) private {
        for (uint256 i; i < path.length - 1; ++i) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = _sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) =
                input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address recipient = i < path.length - 2 ? _pairFor(output, path[i + 2]) : finalRecipient;
            IBBBFiSwapPair(_pairFor(input, output)).swap(amount0Out, amount1Out, recipient);
        }
    }

    function _getReserves(address tokenA, address tokenB)
        private
        view
        returns (uint256 reserveA, uint256 reserveB)
    {
        address pair = IBBBFiSwapFactory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) return (0, 0);
        (uint112 reserve0, uint112 reserve1,) = IBBBFiSwapPair(pair).getReserves();
        (address token0,) = _sortTokens(tokenA, tokenB);
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _pairFor(address tokenA, address tokenB) private view returns (address pair) {
        pair = IBBBFiSwapFactory(factory).getPair(tokenA, tokenB);
        require(pair != address(0), "pair not found");
    }

    function _sortTokens(address tokenA, address tokenB)
        private
        pure
        returns (address token0, address token1)
    {
        require(tokenA != tokenB, "identical tokens");
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(token0 != address(0), "zero token");
    }

    function _safeTransferXDC(address to, uint256 amount) private {
        (bool success,) = payable(to).call{value: amount}("");
        require(success, "XDC transfer failed");
    }
}
