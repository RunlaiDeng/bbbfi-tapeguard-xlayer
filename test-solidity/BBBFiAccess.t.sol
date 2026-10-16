// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BBBFiAccess} from "../contracts/BBBFiAccess.sol";

interface VmAccess {
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert() external;
}

contract AccessUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract AccessImplementation {}

contract AccessBeacon {
    address public implementation;

    function set(address a) external {
        implementation = a;
    }
}

contract AccessFactory {
    function isCPU(address) external pure returns (bool) {
        return true;
    }

    function circuitBeacon() external pure returns (address) {
        return address(0xBEEF);
    }
}

contract AccessCircuit {
    bool public stopped;

    function stop() external {
        stopped = true;
    }

    function netlist(uint256) external pure returns (bytes memory) {
        return hex"00000002000003000000060000060000000400000500000008000008000000070000090000000a00000a";
    }

    function circuitInfo(uint256) external pure returns (uint32, uint32, uint32, uint32) {
        return (4, 1, 0, 6);
    }

    function eval(uint256, bytes calldata b) external view returns (bytes memory) {
        return abi.encodePacked(bytes1(!stopped && uint8(b[0]) == 15 ? 0x01 : 0x00));
    }
}

contract BBBFiAccessTest {
    VmAccess constant vm = VmAccess(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant USDC = 0xB6CEceAB302E2E4948951eE7843FC24E92933061;
    address constant MERCHANT = address(0xA11CE);
    address constant BUYER = address(0xB0B);
    address constant KEEPER = address(0xC0DE);
    address constant TREASURY = address(0xFEE);
    bytes32 constant AUDIENCE = keccak256("merchant.example");
    AccessUSDC token;
    AccessCircuit circuit;
    BBBFiAccess access;
    uint256 plan;

    function setUp() public {
        vm.chainId(196);
        vm.warp(1000000);
        vm.etch(USDC, address(new AccessUSDC()).code);
        token = AccessUSDC(USDC);
        token.mint(BUYER, 10000e6);
        token.mint(MERCHANT, 100e6);
        vm.etch(0x1f09DAeFA827f02CBb40967cc91b259763760761, address(new AccessFactory()).code);
        vm.etch(address(0xBEEF), address(new AccessBeacon()).code);
        AccessBeacon(address(0xBEEF)).set(address(new AccessImplementation()));
        circuit = new AccessCircuit();
        access = new BBBFiAccess(TREASURY, address(circuit), 1);
        vm.prank(MERCHANT);
        plan = access.createPlan("Paid API", 30e6, 30 days, AUDIENCE);
    }

    function subscribe(uint16 cycles) internal returns (uint256) {
        vm.startPrank(BUYER);
        token.approve(address(access), 30e6 * cycles);
        uint256 id = access.subscribe(plan, cycles, 30e6, 30 days, MERCHANT, AUDIENCE, block.timestamp + 300);
        vm.stopPrank();
        return id;
    }

    function test_FirstPaymentDirectSettlementNoCustody() public {
        subscribe(3);
        require(token.balanceOf(MERCHANT) == 129700000);
        require(token.balanceOf(TREASURY) == 300000);
        require(token.balanceOf(address(access)) == 0);
        require(access.protocolSettled() == 300000);
        require(access.payments() == 1);
        (bool valid, uint64 until) = access.hasAccess(plan, BUYER, AUDIENCE);
        require(valid && until == block.timestamp + 30 days);
    }

    function test_BoundedRenewalsAndExecutorShare() public {
        uint256 id = subscribe(2);
        vm.warp(block.timestamp + 30 days);
        require(access.renewalChecks(id) == 15);
        vm.prank(KEEPER);
        access.charge(id);
        require(token.balanceOf(KEEPER) == 60000);
        require(access.protocolSettled() == 540000);
        require(access.keeperSettled() == 60000);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        access.charge(id);
        require(token.balanceOf(BUYER) == 9940e6);
    }

    function test_EarlyAndDuplicateChargeRejected() public {
        uint256 id = subscribe(3);
        vm.expectRevert();
        access.charge(id);
        vm.warp(block.timestamp + 30 days);
        access.charge(id);
        vm.expectRevert();
        access.charge(id);
    }

    function test_CancelPreservesPaidAccessStopsFutureCharges() public {
        uint256 id = subscribe(3);
        vm.prank(BUYER);
        access.cancelRenewal(id);
        (bool valid,) = access.hasAccess(plan, BUYER, AUDIENCE);
        require(valid);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        access.charge(id);
    }

    function test_RevokedAllowancePreventsRenewal() public {
        uint256 id = subscribe(3);
        vm.prank(BUYER);
        token.approve(address(access), 0);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        access.charge(id);
        require(access.payments() == 1);
    }

    function test_InsufficientBalanceDoesNotGrantAccess() public {
        vm.startPrank(KEEPER);
        token.approve(address(access), 30e6);
        vm.expectRevert();
        access.subscribe(plan, 1, 30e6, 30 days, MERCHANT, AUDIENCE, block.timestamp + 300);
        vm.stopPrank();
        (bool valid,) = access.hasAccess(plan, KEEPER, AUDIENCE);
        require(!valid);
        require(access.payments() == 0);
    }

    function test_TermsMismatchAndExpiredIntentFail() public {
        vm.startPrank(BUYER);
        token.approve(address(access), 30e6);
        vm.expectRevert();
        access.subscribe(plan, 1, 29e6, 30 days, MERCHANT, AUDIENCE, block.timestamp + 300);
        vm.expectRevert();
        access.subscribe(plan, 1, 30e6, 30 days, MERCHANT, AUDIENCE, block.timestamp - 1);
        vm.expectRevert();
        access.subscribe(plan, 1, 30e6, 30 days, MERCHANT, AUDIENCE, block.timestamp + 601);
        vm.stopPrank();
    }

    function test_PausingStopsPaymentsNotPaidAccess() public {
        uint256 id = subscribe(2);
        vm.prank(MERCHANT);
        access.setEnabled(plan, false);
        (bool valid,) = access.hasAccess(plan, BUYER, AUDIENCE);
        require(valid);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        access.charge(id);
    }

    function test_NoBackBillingAfterLongKeeperOutage() public {
        uint256 id = subscribe(3);
        vm.warp(block.timestamp + 300 days);
        access.charge(id);
        (, uint64 until) = access.hasAccess(plan, BUYER, AUDIENCE);
        require(until == block.timestamp + 30 days);
        require(access.payments() == 2);
    }

    function test_MembershipExpiresAndWrongAudienceDenied() public {
        subscribe(1);
        (bool wrong,) = access.hasAccess(plan, BUYER, keccak256("attacker.example"));
        require(!wrong);
        vm.warp(block.timestamp + 30 days);
        (bool expired,) = access.hasAccess(plan, BUYER, AUDIENCE);
        require(!expired);
    }

    function test_SinglePaymentNeverAutoRenews() public {
        uint256 id = subscribe(1);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        access.charge(id);
    }

    function test_ResubscribeCancelsOldAuthorization() public {
        uint256 old = subscribe(3);
        vm.warp(block.timestamp + 31 days);
        uint256 current = subscribe(2);
        require(current != old);
        vm.expectRevert();
        access.charge(old);
    }

    function test_CannotSubscribeAgainWhileActive() public {
        subscribe(3);
        vm.startPrank(BUYER);
        vm.expectRevert();
        access.subscribe(plan, 1, 30e6, 30 days, MERCHANT, AUDIENCE, block.timestamp + 300);
        vm.stopPrank();
    }

    function test_CannotCancelOrPauseOthers() public {
        uint256 id = subscribe(3);
        vm.prank(KEEPER);
        vm.expectRevert();
        access.cancelRenewal(id);
        vm.prank(BUYER);
        vm.expectRevert();
        access.setEnabled(plan, false);
    }

    function test_ImplChangeFailsPaymentsButCancelWorks() public {
        uint256 id = subscribe(3);
        AccessBeacon(address(0xBEEF)).set(address(new AccessImplementation()));
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        access.charge(id);
        vm.prank(BUYER);
        access.cancelRenewal(id);
    }

    function test_CircuitFailureBlocksRealMoneyMovement() public {
        uint256 id = subscribe(3);
        circuit.stop();
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        access.charge(id);
        require(access.payments() == 1);
    }

    function test_MerchantRefundCancelsAndReturnsFullPrice() public {
        uint256 id = subscribe(3);
        uint256 before = token.balanceOf(BUYER);
        vm.startPrank(MERCHANT);
        token.approve(address(access), 30e6);
        access.refundCurrentPeriod(id);
        vm.stopPrank();
        require(token.balanceOf(BUYER) == before + 30e6);
        require(access.refunds() == 30e6);
        (bool valid,) = access.hasAccess(plan, BUYER, AUDIENCE);
        require(!valid);
        vm.expectRevert();
        access.charge(id);
    }

    function test_RefundWithoutMerchantFundsRevertsAllState() public {
        uint256 id = subscribe(3);
        vm.prank(MERCHANT);
        vm.expectRevert();
        access.refundCurrentPeriod(id);
        (bool valid,) = access.hasAccess(plan, BUYER, AUDIENCE);
        require(valid);
        require(access.refunds() == 0);
    }

    function test_PaginationAndCounts() public {
        subscribe(1);
        require(access.getMerchantPlans(MERCHANT, 0, 10).length == 1);
        require(access.getPayerSubscriptions(BUYER, 0, 10).length == 1);
        require(access.getSubscriptions(0, 100).length == 1);
        require(access.getSubscriptions(1, 100).length == 0);
        vm.expectRevert();
        access.getSubscriptions(0, 101);
    }

    function test_InvalidPlansAndCycleLimits() public {
        vm.prank(MERCHANT);
        vm.expectRevert();
        access.createPlan("too cheap", 999999, 30 days, AUDIENCE);
        vm.startPrank(BUYER);
        token.approve(address(access), 10000e6);
        vm.expectRevert();
        access.subscribe(plan, 0, 30e6, 30 days, MERCHANT, AUDIENCE, block.timestamp + 300);
        vm.expectRevert();
        access.subscribe(plan, 13, 30e6, 30 days, MERCHANT, AUDIENCE, block.timestamp + 300);
        vm.stopPrank();
    }
}
