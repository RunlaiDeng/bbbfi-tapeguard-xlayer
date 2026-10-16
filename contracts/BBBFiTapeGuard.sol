// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BBBFiSwapOKBRouter, IBBBFiSwapXLayerFactory} from "./BBBFiSwapXLayer.sol";
import {IBBBFiSwapPair} from "./BBBFiSwap.sol";

interface ITapeCircuits {
    function eval(uint256 id, bytes calldata inputs) external view returns (bytes memory);
    function netlist(uint256 id) external view returns (bytes memory);
    function circuitInfo(uint256 id) external view returns (uint32, uint32, uint32, uint32);
}
interface ITapeFactory {
    function isCPU(address cpu) external view returns (bool);
    function circuitBeacon() external view returns (address);
}
interface ITapeBeacon { function implementation() external view returns (address); }

/// @notice Optional, noncustodial V2 swap path. TapeOut evaluates four on-chain
/// predicates. Reserve impact is NOT an oracle price or a token safety rating.
contract BBBFiTapeGuard is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public constant TAPE_FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    uint256 public constant MIN_GAS_RESERVE = 0.0001 ether;
    uint256 public constant MAX_QUOTE_BLOCKS = 30;
    BBBFiSwapOKBRouter public immutable router;
    ITapeCircuits public immutable circuits;
    uint256 public immutable circuitId;
    address public immutable circuitBeacon;
    address public immutable circuitImplementation;
    bytes32 public immutable implementationCodeHash;
    bytes32 public immutable netlistHash;

    struct Limits {
        uint256 minimumOut;
        uint256 quoteBlock;
        uint256 deadline;
        uint16 maxImpactBps;
        uint16 maxSlippageBps;
    }
    event ProtectedSwap(address indexed trader, address indexed tokenIn, address indexed tokenOut,
        uint256 amountIn, uint256 amountOut, uint256 quoteBlock, uint8 checks);

    constructor(address routerAddress, address processor, uint256 id) {
        require(block.chainid == 196 && routerAddress.code.length != 0, "wrong chain or router");
        require(ITapeFactory(TAPE_FACTORY).isCPU(processor), "unregistered processor");
        router = BBBFiSwapOKBRouter(payable(routerAddress));
        circuits = ITapeCircuits(processor);
        circuitId = id;
        bytes memory expected = hex"00000002000003000000060000060000000400000500000008000008000000070000090000000a00000a";
        netlistHash = keccak256(expected);
        require(keccak256(circuits.netlist(id)) == netlistHash, "wrong policy netlist");
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = circuits.circuitInfo(id);
        require(nIn == 4 && nOut == 1 && nState == 0 && gates == 6, "wrong policy shape");
        circuitBeacon = ITapeFactory(TAPE_FACTORY).circuitBeacon();
        circuitImplementation = ITapeBeacon(circuitBeacon).implementation();
        implementationCodeHash = circuitImplementation.codehash;
        require(circuitImplementation.code.length != 0, "missing implementation");
        for (uint8 i; i < 16; ++i) {
            bytes memory out = circuits.eval(id, abi.encodePacked(bytes1(i)));
            require(out.length == 1 && uint8(out[0]) == (i == 15 ? 1 : 0), "wrong truth table");
        }
    }

    function preview(address trader, uint256 amountIn, address[] calldata path, Limits calldata limits)
        public view returns (uint256 quotedOut, uint256 impactBps, uint8 checks, bool allowed)
    {
        require(path.length >= 2 && path.length <= 4 && amountIn > 0, "invalid route");
        for (uint256 i; i < path.length; ++i)
            for (uint256 j; j < i; ++j) require(path[i] != path[j], "repeated token");
        uint256[] memory amounts = router.getAmountsOut(amountIn, path);
        quotedOut = amounts[amounts.length - 1];
        uint256 spotOut = amountIn;
        address factory = router.factory();
        for (uint256 i; i + 1 < path.length; ++i) {
            address pair = IBBBFiSwapXLayerFactory(factory).getPair(path[i], path[i + 1]);
            (uint112 reserve0, uint112 reserve1,) = IBBBFiSwapPair(pair).getReserves();
            (uint256 reserveIn, uint256 reserveOut) = path[i] < path[i + 1]
                ? (uint256(reserve0), uint256(reserve1)) : (uint256(reserve1), uint256(reserve0));
            require(reserveIn > 0 && reserveOut > 0, "empty liquidity");
            spotOut = spotOut * reserveOut / reserveIn;
        }
        impactBps = spotOut > quotedOut ? (spotOut - quotedOut) * 10_000 / spotOut : 0;
        if (limits.maxImpactBps > 0 && limits.maxImpactBps <= 500 && impactBps <= limits.maxImpactBps) checks |= 1;
        if (limits.maxSlippageBps <= 100 && limits.minimumOut > 0 &&
            limits.minimumOut >= quotedOut - quotedOut * limits.maxSlippageBps / 10_000 &&
            limits.minimumOut <= quotedOut) checks |= 2;
        if (limits.quoteBlock <= block.number && block.number - limits.quoteBlock <= MAX_QUOTE_BLOCKS &&
            limits.deadline >= block.timestamp && limits.deadline <= block.timestamp + 600) checks |= 4;
        if (trader.balance >= MIN_GAS_RESERVE) checks |= 8;
        require(ITapeBeacon(circuitBeacon).implementation() == circuitImplementation &&
            circuitImplementation.codehash == implementationCodeHash, "TapeOut implementation changed");
        require(keccak256(circuits.netlist(circuitId)) == netlistHash, "policy changed");
        bytes memory result = circuits.eval(circuitId, abi.encodePacked(bytes1(checks)));
        allowed = checks == 15 && result.length == 1 && uint8(result[0]) == 1;
    }

    function swap(uint256 amountIn, address[] calldata path, bool nativeIn, bool nativeOut,
        Limits calldata limits) external payable nonReentrant returns (uint256 amountOut)
    {
        require(!(nativeIn && nativeOut), "invalid native route");
        require(msg.value == (nativeIn ? amountIn : 0), "wrong native value");
        address wrapped = router.wrappedOKB();
        require(!nativeIn || path[0] == wrapped, "wrong native input");
        require(!nativeOut || path[path.length - 1] == wrapped, "wrong native output");
        (,, uint8 checks, bool allowed) = preview(msg.sender, amountIn, path, limits);
        require(allowed, "TapeGuard policy rejected");
        address output = path[path.length - 1];
        uint256 beforeOut = nativeOut ? msg.sender.balance : IERC20(output).balanceOf(msg.sender);
        if (nativeIn) {
            router.swapExactOKBForTokens{value: amountIn}(limits.minimumOut, path, msg.sender, limits.deadline);
        } else {
            IERC20 token = IERC20(path[0]);
            uint256 beforeIn = token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender, address(this), amountIn);
            require(token.balanceOf(address(this)) - beforeIn == amountIn, "taxed input unsupported");
            token.forceApprove(address(router), amountIn);
            if (nativeOut) router.swapExactTokensForOKB(amountIn, limits.minimumOut, path, msg.sender, limits.deadline);
            else router.swapExactTokensForTokens(amountIn, limits.minimumOut, path, msg.sender, limits.deadline);
            token.forceApprove(address(router), 0);
        }
        amountOut = (nativeOut ? msg.sender.balance : IERC20(output).balanceOf(msg.sender)) - beforeOut;
        require(amountOut >= limits.minimumOut, "received below minimum");
        emit ProtectedSwap(msg.sender, path[0], output, amountIn, amountOut, limits.quoteBlock, checks);
    }
}
