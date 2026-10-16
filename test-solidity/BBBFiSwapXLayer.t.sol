// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BBBFiWrappedXDC, BBBFiSwapPair} from "../contracts/BBBFiSwap.sol";
import {BBBFiSwapXLayerFactory, BBBFiSwapOKBRouter} from "../contracts/BBBFiSwapXLayer.sol";

interface VmXLayer {
    function deal(address account, uint256 newBalance) external;
    function warp(uint256 newTimestamp) external;
}

contract MockXLayerToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract BBBFiSwapXLayerTest {
    VmXLayer private constant vm = VmXLayer(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockXLayerToken private bbb;
    MockXLayerToken private unsupported;
    BBBFiWrappedXDC private wbnb;
    BBBFiSwapXLayerFactory private factory;
    BBBFiSwapOKBRouter private router;

    receive() external payable {}

    function setUp() public {
        bbb = new MockXLayerToken("BBB", "BBB");
        unsupported = new MockXLayerToken("Other", "OTHER");
        wbnb = new BBBFiWrappedXDC();
        factory = new BBBFiSwapXLayerFactory();
        router = new BBBFiSwapOKBRouter(address(factory), address(wbnb));
        bbb.mint(address(this), 10_000_000 ether);
        unsupported.mint(address(this), 10_000_000 ether);
        bbb.approve(address(router), type(uint256).max);
        unsupported.approve(address(router), type(uint256).max);
        vm.deal(address(this), 1_000 ether);
    }

    function testFactoryPermissionlesslyCreatesDeterministicPairs() public {
        address predicted = factory.predictPair(address(bbb), address(wbnb));
        address pair = factory.createPair(address(wbnb), address(bbb));
        require(pair == predicted, "prediction mismatch");
        require(factory.getPair(address(bbb), address(wbnb)) == pair, "missing canonical pair");
        require(factory.allPairsLength() == 1, "wrong pair count");

        address otherPair = factory.createPair(address(bbb), address(unsupported));
        require(otherPair != address(0), "arbitrary token pair was not created");
        require(factory.allPairsLength() == 2, "permissionless pair missing");

        (bool duplicateSuccess,) = address(factory).call(
            abi.encodeCall(factory.createPair, (address(bbb), address(wbnb)))
        );
        require(!duplicateSuccess, "duplicate pair created");
    }

    function testNativeOKBLiquiditySwapFeeAndWithdrawal() public {
        (uint256 tokenAdded, uint256 bnbAdded, uint256 liquidity) = router.addLiquidityOKB{value: 100 ether}(
            address(bbb), 100_000 ether, 100_000 ether, 100 ether, address(this), block.timestamp
        );
        require(tokenAdded == 100_000 ether && bnbAdded == 100 ether, "wrong deposits");
        require(liquidity != 0, "no LP tokens");

        address pairAddress = factory.getPair(address(bbb), address(wbnb));
        BBBFiSwapPair pair = BBBFiSwapPair(pairAddress);
        require(pair.totalSupply() == 3162_277660168379331998, "unexpected LP supply");

        address[] memory buyPath = new address[](2);
        buyPath[0] = address(wbnb);
        buyPath[1] = address(bbb);
        uint256[] memory quoted = router.getAmountsOut(1 ether, buyPath);
        uint256 amountInWithFee = uint256(1 ether) * 997;
        uint256 expected = amountInWithFee * uint256(100_000 ether)
            / (uint256(100 ether) * 1_000 + amountInWithFee);
        require(quoted[1] == expected, "0.30 percent fee quote mismatch");
        uint256 beforeBBB = bbb.balanceOf(address(this));
        router.swapExactOKBForTokens{value: 1 ether}(quoted[1], buyPath, address(this), block.timestamp);
        require(bbb.balanceOf(address(this)) - beforeBBB == quoted[1], "OKB buy failed");

        address[] memory sellPath = new address[](2);
        sellPath[0] = address(bbb);
        sellPath[1] = address(wbnb);
        uint256[] memory sellQuote = router.getAmountsOut(100 ether, sellPath);
        uint256 beforeOKB = address(this).balance;
        router.swapExactTokensForOKB(100 ether, sellQuote[1], sellPath, address(this), block.timestamp);
        require(address(this).balance - beforeOKB == sellQuote[1], "BBB sell failed");

        uint256 lpToRemove = pair.balanceOf(address(this)) / 2;
        pair.approve(address(router), lpToRemove);
        beforeOKB = address(this).balance;
        (uint256 removedBBB, uint256 removedOKB) = router.removeLiquidityOKB(
            address(bbb), lpToRemove, 1, 1, address(this), block.timestamp
        );
        require(removedBBB != 0 && removedOKB != 0, "nothing removed");
        require(address(this).balance - beforeOKB == removedOKB, "OKB was not unwrapped");
    }

    function testArbitraryTokenLiquidityAndMultiHopSwap() public {
        router.addLiquidityOKB{value: 100 ether}(
            address(bbb), 100_000 ether, 1, 1, address(this), block.timestamp
        );
        (,, uint256 liquidity) = router.addLiquidity(
            address(bbb),
            address(unsupported),
            100_000 ether,
            200_000 ether,
            1,
            1,
            address(this),
            block.timestamp
        );
        require(liquidity != 0, "arbitrary token liquidity failed");

        address[] memory path = new address[](3);
        path[0] = address(wbnb);
        path[1] = address(bbb);
        path[2] = address(unsupported);
        uint256[] memory quote = router.getAmountsOut(1 ether, path);
        uint256 beforeOther = unsupported.balanceOf(address(this));
        router.swapExactOKBForTokens{value: 1 ether}(quote[2], path, address(this), block.timestamp);
        require(unsupported.balanceOf(address(this)) - beforeOther == quote[2], "multi-hop swap failed");

        (bool directSuccess,) = address(router).call{value: 1 ether}("");
        require(!directSuccess, "direct OKB accepted");
    }

    function testDeadlineAndSlippageAreEnforced() public {
        router.addLiquidityOKB{value: 10 ether}(
            address(bbb), 10_000 ether, 1, 1, address(this), block.timestamp
        );
        address[] memory path = new address[](2);
        path[0] = address(wbnb);
        path[1] = address(bbb);

        (bool slippageSuccess,) = address(router).call{value: 1 ether}(
            abi.encodeCall(
                router.swapExactOKBForTokens,
                (type(uint256).max, path, address(this), block.timestamp)
            )
        );
        require(!slippageSuccess, "impossible minimum accepted");

        vm.warp(block.timestamp + 10);
        (bool deadlineSuccess,) = address(router).call{value: 1 ether}(
            abi.encodeCall(router.swapExactOKBForTokens, (0, path, address(this), block.timestamp - 1))
        );
        require(!deadlineSuccess, "expired swap accepted");
    }
}
