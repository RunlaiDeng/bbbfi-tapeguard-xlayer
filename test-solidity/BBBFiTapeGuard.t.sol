// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BBBFiWrappedXDC} from "../contracts/BBBFiSwap.sol";
import {BBBFiSwapXLayerFactory, BBBFiSwapOKBRouter} from "../contracts/BBBFiSwapXLayer.sol";
import {BBBFiTapeGuard} from "../contracts/BBBFiTapeGuard.sol";
interface VmTape {
    function deal(address, uint256) external;
    function chainId(uint256) external;
    function etch(address, bytes calldata) external;
    function roll(uint256) external;
    function warp(uint256) external;
}
contract TapeTestToken is ERC20 {
    constructor() ERC20("Test token", "TEST") { _mint(msg.sender, 1_000_000 ether); }
}
contract TapeTestImplementation {}
contract TapeTestBeacon {
    address public implementation;
    function set(address next) external { implementation = next; }
}
contract TapeTestFactory {
    function isCPU(address) external pure returns (bool) { return true; }
    function circuitBeacon() external pure returns (address) { return address(0xBEEF); }
}
contract TapeTestCircuit {
    bool public disabled;
    function setDisabled() external { disabled = true; }
    function netlist(uint256) external pure returns (bytes memory) {
        return hex"00000002000003000000060000060000000400000500000008000008000000070000090000000a00000a";
    }
    function circuitInfo(uint256) external pure returns (uint32, uint32, uint32, uint32) { return (4,1,0,6); }
    function eval(uint256, bytes calldata inputs) external view returns (bytes memory) {
        return abi.encodePacked(bytes1(!disabled && uint8(inputs[0]) == 15 ? 0x01 : 0x00));
    }
}
contract BBBFiTapeGuardTest {
    VmTape constant vm = VmTape(address(uint160(uint256(keccak256("hevm cheat code")))));
    TapeTestToken token;
    BBBFiWrappedXDC wrapped;
    BBBFiSwapXLayerFactory factory;
    BBBFiSwapOKBRouter router;
    BBBFiTapeGuard guard;
    TapeTestCircuit circuit;
    receive() external payable {}
    function setUp() public {
        vm.chainId(196); vm.roll(100); vm.warp(1000); vm.deal(address(this), 1000 ether);
        token = new TapeTestToken(); wrapped = new BBBFiWrappedXDC();
        factory = new BBBFiSwapXLayerFactory(); router = new BBBFiSwapOKBRouter(address(factory), address(wrapped));
        token.approve(address(router), type(uint256).max);
        router.addLiquidityOKB{value:100 ether}(address(token), 100_000 ether, 1, 1, address(this), block.timestamp);
        vm.etch(0x1f09DAeFA827f02CBb40967cc91b259763760761, address(new TapeTestFactory()).code);
        vm.etch(address(0xBEEF), address(new TapeTestBeacon()).code);
        TapeTestBeacon(address(0xBEEF)).set(address(new TapeTestImplementation()));
        circuit = new TapeTestCircuit(); guard = new BBBFiTapeGuard(address(router), address(circuit), 1);
        token.approve(address(guard), type(uint256).max);
    }
    function path(bool reverse) internal view returns (address[] memory p) {
        p=new address[](2);p[0]=reverse?address(token):address(wrapped);p[1]=reverse?address(wrapped):address(token);
    }
    function limits(uint256 amount, address[] memory p) internal view returns (BBBFiTapeGuard.Limits memory) {
        uint256[] memory out=router.getAmountsOut(amount,p);
        return BBBFiTapeGuard.Limits(out[1]-out[1]*50/10_000,block.number,block.timestamp+300,300,50);
    }
    function rejected(uint256 amount, address[] memory p, bool nIn, bool nOut, BBBFiTapeGuard.Limits memory l) internal {
        (bool ok,)=address(guard).call{value:nIn?amount:0}(abi.encodeCall(guard.swap,(amount,p,nIn,nOut,l)));
        require(!ok,"unsafe swap accepted");
    }
    function testProtectedNativeSwapAndNoCustody() public {
        address[] memory p=path(false); uint256 before=token.balanceOf(address(this));
        uint256 out=guard.swap{value:1 ether}(1 ether,p,true,false,limits(1 ether,p));
        require(out==token.balanceOf(address(this))-before && out>0,"output mismatch");
        require(address(guard).balance==0 && token.balanceOf(address(guard))==0,"custody residue");
    }
    function testProtectedTokenToNativeClearsApproval() public {
        address[] memory p=path(true); uint256 before=address(this).balance;
        uint256 out=guard.swap(100 ether,p,false,true,limits(100 ether,p));
        require(address(this).balance-before==out && out>0,"native output mismatch");
        require(token.allowance(address(guard),address(router))==0,"approval residue");
    }
    function testProtectedTokenToToken() public {
        TapeTestToken other=new TapeTestToken();other.approve(address(router),type(uint256).max);
        router.addLiquidity(address(token),address(other),10_000 ether,10_000 ether,1,1,address(this),block.timestamp);
        address[] memory p=new address[](2);p[0]=address(token);p[1]=address(other);
        require(guard.swap(1 ether,p,false,false,limits(1 ether,p))>0,"token swap failed");
    }
    function testRejectExcessImpact() public { address[] memory p=path(false);rejected(10 ether,p,true,false,limits(10 ether,p)); }
    function testRejectWeakMinimum() public { address[] memory p=path(false);BBBFiTapeGuard.Limits memory l=limits(1 ether,p);l.minimumOut=1;rejected(1 ether,p,true,false,l); }
    function testRejectDisabledCircuit() public { address[] memory p=path(false);circuit.setDisabled();rejected(1 ether,p,true,false,limits(1 ether,p)); }
    function testRejectChangedImplementation() public { address[] memory p=path(false);TapeTestBeacon(address(0xBEEF)).set(address(new TapeTestImplementation()));rejected(1 ether,p,true,false,limits(1 ether,p)); }
    function testRejectStaleQuote() public { address[] memory p=path(false);BBBFiTapeGuard.Limits memory l=limits(1 ether,p);vm.roll(131);rejected(1 ether,p,true,false,l); }
    function testRejectFutureQuote() public { address[] memory p=path(false);BBBFiTapeGuard.Limits memory l=limits(1 ether,p);l.quoteBlock=101;rejected(1 ether,p,true,false,l); }
    function testRejectExpiredDeadline() public { address[] memory p=path(false);BBBFiTapeGuard.Limits memory l=limits(1 ether,p);vm.warp(1400);rejected(1 ether,p,true,false,l); }
    function testRejectExcessDeadline() public { address[] memory p=path(false);BBBFiTapeGuard.Limits memory l=limits(1 ether,p);l.deadline=block.timestamp+601;rejected(1 ether,p,true,false,l); }
    function testRejectDrainedGasReserve() public { address[] memory p=path(false);BBBFiTapeGuard.Limits memory l=limits(1 ether,p);vm.deal(address(this),1 ether);rejected(1 ether,p,true,false,l); }
    function testRejectLoosenedCaps() public { address[] memory p=path(false);BBBFiTapeGuard.Limits memory l=limits(1 ether,p);l.maxImpactBps=501;rejected(1 ether,p,true,false,l);l.maxImpactBps=300;l.maxSlippageBps=101;rejected(1 ether,p,true,false,l); }
    function testRejectWrongNativeValue() public { address[] memory p=path(false);(bool ok,)=address(guard).call{value:2 ether}(abi.encodeCall(guard.swap,(1 ether,p,true,false,limits(1 ether,p))));require(!ok,"wrong value accepted"); }
    function testRejectRepeatedRoute() public { address[] memory p=new address[](3);p[0]=address(wrapped);p[1]=address(token);p[2]=address(wrapped);BBBFiTapeGuard.Limits memory l=BBBFiTapeGuard.Limits(1,100,1300,300,50);rejected(1 ether,p,true,true,l); }
    function testPreviewCheckMask() public view { address[] memory p=path(false);(,,uint8 mask,bool allowed)=guard.preview(address(this),1 ether,p,limits(1 ether,p));require(mask==15 && allowed,"good checks rejected"); }
}
