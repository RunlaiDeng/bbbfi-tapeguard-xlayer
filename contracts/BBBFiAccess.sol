// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAccessTape {
    function eval(uint256, bytes calldata) external view returns (bytes memory);
    function netlist(uint256) external view returns (bytes memory);
    function circuitInfo(uint256) external view returns (uint32, uint32, uint32, uint32);
}

interface IAccessTapeFactory {
    function isCPU(address) external view returns (bool);
    function circuitBeacon() external view returns (address);
}

interface IAccessBeacon {
    function implementation() external view returns (address);
}

/// @notice Fixed-price USDC memberships. Funds settle directly to merchant,
/// protocol and executor; there is no user deposit balance or arbitrary call.
contract BBBFiAccess is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public constant USDC = 0xB6CEceAB302E2E4948951eE7843FC24E92933061;
    address public constant TAPE_FACTORY = 0x1f09DAeFA827f02CBb40967cc91b259763760761;
    uint256 public constant FEE_BPS = 100; // 1% of successful payment, deducted from merchant gross.
    uint256 public constant KEEPER_BPS = 20; // Renewals: 0.2% gross goes to permissionless executor.
    uint256 public constant MAX_CYCLES = 12;
    address public immutable feeRecipient;
    IAccessTape public immutable circuits;
    uint256 public immutable circuitId;
    address public immutable beacon;
    address public immutable implementation;
    bytes32 public immutable implementationHash;
    bytes32 public immutable netlistHash;

    struct Plan {
        address merchant;
        uint64 period;
        bool enabled;
        uint256 price;
        bytes32 audience;
        string title;
    }

    struct Subscription {
        address payer;
        uint64 paidUntil;
        uint16 remaining;
        uint16 authorizedCycles;
        uint256 planId;
        bool cancelled;
    }
    uint256 public planCount;
    uint256 public subscriptionCount;
    uint256 public payments;
    uint256 public grossSettled;
    uint256 public protocolSettled;
    uint256 public keeperSettled;
    uint256 public refunds;
    mapping(uint256 => Plan) public plans;
    mapping(uint256 => Subscription) public subscriptions;
    mapping(uint256 => mapping(address => uint256)) public membershipId;
    mapping(address => uint256[]) private merchantPlans;
    mapping(address => uint256[]) private payerSubscriptions;
    mapping(address => uint256) public merchantGross;
    mapping(address => uint256) public merchantRefunds;
    event PlanCreated(
        uint256 indexed id,
        address indexed merchant,
        uint256 price,
        uint64 period,
        bytes32 audience,
        string title
    );
    event PlanEnabled(uint256 indexed id, bool enabled);
    event Paid(
        uint256 indexed subscriptionId,
        uint256 indexed planId,
        address indexed payer,
        address merchant,
        uint256 gross,
        uint256 protocolFee,
        uint256 executorReward,
        uint64 paidUntil,
        bool renewal
    );
    event Cancelled(uint256 indexed subscriptionId, address indexed payer);
    event Refunded(
        uint256 indexed subscriptionId, address indexed merchant, address indexed payer, uint256 amount
    );

    constructor(address recipient, address processor, uint256 id) {
        require(
            block.chainid == 196 && USDC.code.length != 0 && IERC20Metadata(USDC).decimals() == 6,
            "wrong chain or USDC"
        );
        require(recipient != address(0) && recipient != address(this), "invalid recipient");
        require(IAccessTapeFactory(TAPE_FACTORY).isCPU(processor), "unregistered processor");
        feeRecipient = recipient;
        circuits = IAccessTape(processor);
        circuitId = id;
        bytes memory expected =
            hex"00000002000003000000060000060000000400000500000008000008000000070000090000000a00000a";
        netlistHash = keccak256(expected);
        require(keccak256(circuits.netlist(id)) == netlistHash, "wrong netlist");
        (uint32 nIn, uint32 nOut, uint32 nState, uint32 gates) = circuits.circuitInfo(id);
        require(nIn == 4 && nOut == 1 && nState == 0 && gates == 6, "wrong circuit");
        beacon = IAccessTapeFactory(TAPE_FACTORY).circuitBeacon();
        implementation = IAccessBeacon(beacon).implementation();
        implementationHash = implementation.codehash;
        require(implementation.code.length != 0, "no implementation");
        for (uint8 i; i < 16; ++i) {
            bytes memory out = circuits.eval(id, abi.encodePacked(bytes1(i)));
            require(out.length == 1 && uint8(out[0]) == (i == 15 ? 1 : 0), "wrong truth table");
        }
    }

    function createPlan(string calldata title, uint256 price, uint64 period, bytes32 audience)
        external
        returns (uint256 id)
    {
        require(bytes(title).length > 0 && bytes(title).length <= 80, "invalid title");
        require(
            price >= 1e6 && price <= 1e12 && period >= 1 days && period <= 365 days && audience != bytes32(0),
            "invalid terms"
        );
        id = ++planCount;
        plans[id] = Plan(msg.sender, period, true, price, audience, title);
        merchantPlans[msg.sender].push(id);
        emit PlanCreated(id, msg.sender, price, period, audience, title);
    }

    function setEnabled(uint256 id, bool enabled) external {
        require(plans[id].merchant == msg.sender, "not merchant");
        plans[id].enabled = enabled;
        emit PlanEnabled(id, enabled);
    }

    function subscribe(
        uint256 planId,
        uint16 cycles,
        uint256 expectedPrice,
        uint64 expectedPeriod,
        address expectedMerchant,
        bytes32 expectedAudience,
        uint256 deadline
    ) external nonReentrant returns (uint256 id) {
        Plan storage p = plans[planId];
        uint8 mask;
        if (p.merchant != address(0) && p.enabled && msg.sender != p.merchant) mask |= 1;
        if (
            p.price == expectedPrice && p.period == expectedPeriod && p.merchant == expectedMerchant
                && p.audience == expectedAudience
        ) mask |= 2;
        if (
            cycles > 0 && cycles <= MAX_CYCLES && block.timestamp <= deadline
                && deadline <= block.timestamp + 10 minutes
        ) {
            mask |= 4;
        }
        if (
            IERC20(USDC).balanceOf(msg.sender) >= p.price
                && IERC20(USDC).allowance(msg.sender, address(this)) >= p.price * cycles
        ) mask |= 8;
        _allow(mask);
        uint256 previous = membershipId[planId][msg.sender];
        if (previous != 0) {
            require(subscriptions[previous].paidUntil <= block.timestamp, "membership still active");
            subscriptions[previous].remaining = 0;
            subscriptions[previous].cancelled = true;
        }
        id = ++subscriptionCount;
        subscriptions[id] =
            Subscription(msg.sender, uint64(block.timestamp + p.period), cycles - 1, cycles, planId, false);
        membershipId[planId][msg.sender] = id;
        payerSubscriptions[msg.sender].push(id);
        _settle(id, false, address(0));
    }

    /// @dev Four factual, onchain predicates; no caller-supplied payment flags.
    function renewalChecks(uint256 id) public view returns (uint8 mask) {
        Subscription storage s = subscriptions[id];
        Plan storage p = plans[s.planId];
        if (p.merchant != address(0) && p.enabled) mask |= 1;
        if (s.paidUntil > 0 && block.timestamp >= s.paidUntil) mask |= 2;
        if (!s.cancelled && s.remaining > 0 && membershipId[s.planId][s.payer] == id) mask |= 4;
        if (
            p.price > 0 && IERC20(USDC).balanceOf(s.payer) >= p.price
                && IERC20(USDC).allowance(s.payer, address(this)) >= p.price
        ) mask |= 8;
    }

    function charge(uint256 id) external nonReentrant {
        _allow(renewalChecks(id));
        Subscription storage s = subscriptions[id];
        s.remaining--;
        s.paidUntil = uint64(block.timestamp + plans[s.planId].period);
        _settle(id, true, msg.sender);
    }

    function cancelRenewal(uint256 id) external {
        Subscription storage s = subscriptions[id];
        require(s.payer == msg.sender, "not payer");
        s.remaining = 0;
        s.cancelled = true;
        emit Cancelled(id, msg.sender);
    }

    function refundCurrentPeriod(uint256 id) external nonReentrant {
        Subscription storage s = subscriptions[id];
        Plan storage p = plans[s.planId];
        require(p.merchant == msg.sender && s.paidUntil > block.timestamp, "not refundable");
        s.paidUntil = uint64(block.timestamp);
        s.remaining = 0;
        s.cancelled = true;
        merchantRefunds[msg.sender] += p.price;
        refunds += p.price;
        IERC20(USDC).safeTransferFrom(msg.sender, s.payer, p.price);
        emit Refunded(id, msg.sender, s.payer, p.price);
    }

    function hasAccess(uint256 planId, address payer, bytes32 audience) external view returns (bool, uint64) {
        Plan storage p = plans[planId];
        Subscription storage s = subscriptions[membershipId[planId][payer]];
        return (
            p.merchant != address(0) && p.audience == audience && s.paidUntil > block.timestamp, s.paidUntil
        );
    }

    function getMerchantPlans(address merchant, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory)
    {
        return _page(merchantPlans[merchant], offset, limit);
    }

    function getPayerSubscriptions(address payer, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory)
    {
        return _page(payerSubscriptions[payer], offset, limit);
    }

    function getSubscriptions(uint256 offset, uint256 limit)
        external
        view
        returns (Subscription[] memory result)
    {
        require(limit > 0 && limit <= 100, "invalid page");
        uint256 end = offset + limit;
        if (end > subscriptionCount) end = subscriptionCount;
        if (offset >= end) return new Subscription[](0);
        result = new Subscription[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = subscriptions[i + 1];
        }
    }

    function _page(uint256[] storage list, uint256 offset, uint256 limit)
        private
        view
        returns (uint256[] memory result)
    {
        require(limit > 0 && limit <= 100, "invalid page");
        uint256 end = offset + limit;
        if (end > list.length) end = list.length;
        if (offset >= end) return new uint256[](0);
        result = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = list[i];
        }
    }

    function _settle(uint256 id, bool renewal, address executor) private {
        Subscription storage s = subscriptions[id];
        Plan storage p = plans[s.planId];
        uint256 fee = p.price * FEE_BPS / 10000;
        uint256 reward = renewal ? p.price * KEEPER_BPS / 10000 : 0;
        payments++;
        grossSettled += p.price;
        protocolSettled += fee - reward;
        keeperSettled += reward;
        merchantGross[p.merchant] += p.price;
        IERC20(USDC).safeTransferFrom(s.payer, p.merchant, p.price - fee);
        IERC20(USDC).safeTransferFrom(s.payer, feeRecipient, fee - reward);
        if (reward != 0) IERC20(USDC).safeTransferFrom(s.payer, executor, reward);
        emit Paid(id, s.planId, s.payer, p.merchant, p.price, fee - reward, reward, s.paidUntil, renewal);
    }

    function _allow(uint8 mask) private view {
        require(
            IAccessBeacon(beacon).implementation() == implementation
                && implementation.codehash == implementationHash
                && keccak256(circuits.netlist(circuitId)) == netlistHash,
            "policy changed"
        );
        bytes memory out = circuits.eval(circuitId, abi.encodePacked(bytes1(mask)));
        require(mask == 15 && out.length == 1 && uint8(out[0]) == 1, "payment policy rejected");
    }
}
