// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BBBFiSwapPair, IBBBFiSwapPair} from "./BBBFiSwap.sol";

interface IBBBFiWOKB is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IBBBFiSwapXLayerFactory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

/**
 * Permissionless XLayer pair registry. Any address may create a pair between two
 * token contracts. There is no owner, fee switch, proxy, upgrade hook, or
 * administrative withdrawal path.
 */
contract BBBFiSwapXLayerFactory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 pairCount);

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    function createPair(address tokenA, address tokenB) public returns (address pair) {
        require(tokenA != tokenB, "identical tokens");
        (address token0, address token1) = _sortTokens(tokenA, tokenB);
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
        (address token0, address token1) = _sortTokens(tokenA, tokenB);
        require(token0 != address(0), "zero token");
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        bytes32 initCodeHash =
            keccak256(abi.encodePacked(type(BBBFiSwapPair).creationCode, abi.encode(token0, token1)));
        predicted = address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))))
        );
    }

    function _sortTokens(address tokenA, address tokenB) private pure returns (address token0, address token1) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }
}

/**
 * Stateless permissionless XLayer router using canonical WOKB. Users sign their
 * own approvals, liquidity, and swap transactions. Every hop uses the fixed
 * 0.30% LP fee enforced by BBBFiSwapPair.
 */
contract BBBFiSwapOKBRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable factory;
    address public immutable wrappedOKB;

    modifier ensure(uint256 deadline) {
        require(deadline >= block.timestamp, "expired");
        _;
    }

    constructor(address factoryAddress, address wrappedOKBAddress) {
        require(factoryAddress.code.length != 0 && wrappedOKBAddress.code.length != 0, "invalid contract");
        factory = factoryAddress;
        wrappedOKB = wrappedOKBAddress;
    }

    receive() external payable {
        require(msg.sender == wrappedOKB, "direct OKB rejected");
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

    function addLiquidityOKB(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountOKBMin,
        address to,
        uint256 deadline
    )
        external
        payable
        nonReentrant
        ensure(deadline)
        returns (uint256 amountToken, uint256 amountOKB, uint256 liquidity)
    {
        require(token != wrappedOKB, "invalid token");
        address pair;
        (amountToken, amountOKB, pair) =
            _addLiquidity(token, wrappedOKB, amountTokenDesired, msg.value, amountTokenMin, amountOKBMin);
        IERC20(token).safeTransferFrom(msg.sender, pair, amountToken);
        IBBBFiWOKB(wrappedOKB).deposit{value: amountOKB}();
        IERC20(wrappedOKB).safeTransfer(pair, amountOKB);
        liquidity = IBBBFiSwapPair(pair).mint(to);
        if (msg.value > amountOKB) _safeTransferOKB(msg.sender, msg.value - amountOKB);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = _pairFor(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IBBBFiSwapPair(pair).burn(to);
        (address token0,) = _sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin && amountB >= amountBMin, "insufficient withdrawn amount");
    }

    function removeLiquidityOKB(
        address token,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountOKBMin,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256 amountToken, uint256 amountOKB) {
        require(token != wrappedOKB, "invalid token");
        address pair = _pairFor(token, wrappedOKB);
        IERC20(pair).safeTransferFrom(msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IBBBFiSwapPair(pair).burn(address(this));
        (address token0,) = _sortTokens(token, wrappedOKB);
        (amountToken, amountOKB) = token == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountToken >= amountTokenMin && amountOKB >= amountOKBMin, "insufficient withdrawn amount");
        IERC20(token).safeTransfer(to, amountToken);
        IBBBFiWOKB(wrappedOKB).withdraw(amountOKB);
        _safeTransferOKB(to, amountOKB);
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

    function swapExactOKBForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2 && path[0] == wrappedOKB, "invalid OKB path");
        amounts = getAmountsOut(msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, "insufficient output amount");
        IBBBFiWOKB(wrappedOKB).deposit{value: amounts[0]}();
        IERC20(wrappedOKB).safeTransfer(_pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
    }

    function swapExactTokensForOKB(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external nonReentrant ensure(deadline) returns (uint256[] memory amounts) {
        require(path.length >= 2 && path[path.length - 1] == wrappedOKB, "invalid OKB path");
        amounts = getAmountsOut(amountIn, path);
        uint256 amountOut = amounts[amounts.length - 1];
        require(amountOut >= amountOutMin, "insufficient output amount");
        IERC20(path[0]).safeTransferFrom(msg.sender, _pairFor(path[0], path[1]), amounts[0]);
        _swap(amounts, path, address(this));
        IBBBFiWOKB(wrappedOKB).withdraw(amountOut);
        _safeTransferOKB(to, amountOut);
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) public pure returns (uint256 amountB) {
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
        pair = IBBBFiSwapXLayerFactory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) pair = IBBBFiSwapXLayerFactory(factory).createPair(tokenA, tokenB);
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
        address pair = IBBBFiSwapXLayerFactory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) return (0, 0);
        (uint112 reserve0, uint112 reserve1,) = IBBBFiSwapPair(pair).getReserves();
        (address token0,) = _sortTokens(tokenA, tokenB);
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function _pairFor(address tokenA, address tokenB) private view returns (address pair) {
        pair = IBBBFiSwapXLayerFactory(factory).getPair(tokenA, tokenB);
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

    function _safeTransferOKB(address to, uint256 amount) private {
        (bool success,) = payable(to).call{value: amount}("");
        require(success, "OKB transfer failed");
    }
}
