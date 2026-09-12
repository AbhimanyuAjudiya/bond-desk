// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IATSFactory} from "ats/IATSFactory.sol";
import {IATSAdmin} from "ats/IATSAdmin.sol";
import {
    DEFAULT_ADMIN_ROLE,
    ROLE_SSI_MANAGER,
    ROLE_KYC,
    ROLE_ISSUER,
    ROLE_FREEZE_MANAGER,
    ROLE_PAUSER,
    ROLE_CONTROLLER,
    ROLE_CORPORATE_ACTION,
    ROLE_INTEREST_RATE_MANAGER,
    BOND_CONFIG_ID
} from "ats/ATSRoles.sol";

/// @notice Issue the demo bond through the ATS factory on Hedera testnet, KYC the demo wallets, mint the supply
///         to the issuer and record everything under `bond` in `ats/testnet.json`.
/// @dev Run (issuer = HEDERA_PRIVATE_KEY, which also becomes the token's DEFAULT_ADMIN):
///        forge script ats/script/CreateBond.s.sol:CreateBond --rpc-url hedera --broadcast --slow -vvvv
///      Env: HEDERA_PRIVATE_KEY, COMPLIANCE_OFFICER, INVESTOR1, INVESTOR2, INVESTOR3_NOKYC,
///           BOND_SUPPLY (default 100), MATURITY_DELAY (seconds, default 365 days).
///      Any further bond, same wallets and roles, appended to the `bonds` array of `ats/testnet.json`
///      (maturity is an absolute unix time; the ISIN must pass the Luhn check below, as the factory enforces it):
///        forge script ats/script/CreateBond.s.sol:CreateBond \
///          --sig "create(string,string,string,uint256,uint256)" "Bond Desk 7.25% 2028" BDB28 XS2028091200 60 1852329600 \
///          --rpc-url hedera --broadcast --slow -vvvv
///      Encoding check without a chain or env:
///        forge script ats/script/CreateBond.s.sol:CreateBond --sig "dryRun()"
///      ISIN US0378331005 (Luhn over "3028 037833100 5", letters U=30 S=28): doubling every second digit from
///      the right (0,1,3,7,0,2,3 -> 0,2,6,14->5,0,4,6 = 23) plus the others (5+0+3+8+3+8+0 = 27) gives 50 -> valid.
contract CreateBond is Script {
    string internal constant NAME = "Bond Desk 5% 2027";
    string internal constant SYMBOL = "BDB27";
    string internal constant ISIN = "US0378331005";
    uint256 internal constant TEN_YEARS = 3650 days;
    string internal constant CFG = "ats/testnet.json";

    error NoCode(address at);
    error BadIsin(string isin);
    error Unexpected(string what);

    struct Env {
        address issuer;
        address officer;
        address inv1;
        address inv2;
        address inv3;
        uint256 supply;
        uint256 maturity;
        string name;
        string symbol;
        string isin;
    }

    /// @notice Bond 1 (`bond` in ats/testnet.json).
    function run() external {
        Env memory e = _env(
            NAME, SYMBOL, ISIN, vm.envOr("BOND_SUPPLY", uint256(100)), block.timestamp + vm.envOr("MATURITY_DELAY", uint256(365 days))
        );
        _write(_create(e), e);
    }

    /// @notice Any further bond, appended to `bonds` in ats/testnet.json.
    function create(string memory name, string memory symbol, string memory isin, uint256 supply, uint256 maturity)
        external
    {
        Env memory e = _env(name, symbol, isin, supply, maturity);
        _append(_create(e), e);
    }

    function _env(string memory name, string memory symbol, string memory isin, uint256 supply, uint256 maturity)
        internal
        view
        returns (Env memory)
    {
        return Env({
            issuer: vm.addr(vm.envUint("HEDERA_PRIVATE_KEY")),
            officer: vm.envAddress("COMPLIANCE_OFFICER"),
            inv1: vm.envAddress("INVESTOR1"),
            inv2: vm.envAddress("INVESTOR2"),
            inv3: vm.envAddress("INVESTOR3_NOKYC"),
            supply: supply,
            maturity: maturity,
            name: name,
            symbol: symbol,
            isin: isin
        });
    }

    function _create(Env memory e) internal returns (address token) {
        string memory cfg = vm.readFile(CFG);
        address factory = vm.parseJsonAddress(cfg, ".factory");
        address blr = vm.parseJsonAddress(cfg, ".blr");
        if (factory.code.length == 0) revert NoCode(factory);
        if (blr.code.length == 0) revert NoCode(blr);
        if (!_luhn(e.isin)) revert BadIsin(e.isin);

        (IATSFactory.BondData memory data, IATSFactory.FactoryRegulationData memory reg) = _bond(blr, e, block.timestamp);

        vm.startBroadcast(vm.envUint("HEDERA_PRIVATE_KEY"));
        token = IATSFactory(factory).deployBond(data, reg);
        _issue(IATSAdmin(token), e);
        vm.stopBroadcast();

        _check(IATSAdmin(token), e);
        console.log("bond token:", token);
        console.log("maturity:  ", e.maturity);
        console.log("https://hashscan.io/testnet/contract/%s", token);
    }

    /// @dev Order matters: SSI issuer before any grantKyc; the issuer's own KYC before mint.
    function _issue(IATSAdmin t, Env memory e) internal {
        uint256 from = block.timestamp - 1;
        uint256 to = block.timestamp + TEN_YEARS;
        t.addIssuer(e.issuer);
        t.grantKyc(e.issuer, "vc:issuer", from, to, e.issuer);
        t.grantKyc(e.inv1, "vc:investor1", from, to, e.issuer);
        t.grantKyc(e.inv2, "vc:investor2", from, to, e.issuer);
        t.mint(e.issuer, e.supply);
    }

    function _check(IATSAdmin t, Env memory e) internal view {
        if (t.getKycStatusFor(e.issuer) != 1 || t.getKycStatusFor(e.inv1) != 1 || t.getKycStatusFor(e.inv2) != 1) {
            revert Unexpected("kyc");
        }
        if (t.getKycStatusFor(e.inv3) != 0) revert Unexpected("inv3 kyc");
        if (t.balanceOf(e.issuer) != e.supply || t.totalSupply() != e.supply) revert Unexpected("supply");
        if (t.getMaturityDate() != e.maturity) revert Unexpected("maturity");
    }

    function _write(address token, Env memory e) internal {
        address[] memory investors = new address[](2);
        investors[0] = e.inv1;
        investors[1] = e.inv2;
        string memory b = "bond";
        vm.serializeAddress(b, "token", token);
        vm.serializeString(b, "isin", e.isin);
        vm.serializeAddress(b, "issuer", e.issuer);
        vm.serializeAddress(b, "complianceOfficer", e.officer);
        vm.serializeAddress(b, "investors", investors);
        vm.serializeAddress(b, "nonKyc", e.inv3);
        vm.serializeUint(b, "supply", e.supply);
        string memory out = vm.serializeUint(b, "maturityDate", e.maturity);
        vm.writeJson(out, CFG, ".bond");
    }

    /// @dev `vm.writeJson` cannot address `.bonds[i]`, so the array is rebuilt from the entries already there.
    function _append(address token, Env memory e) internal {
        string memory j = vm.readFile(CFG);
        string memory arr = "[";
        for (uint256 i; vm.keyExistsJson(j, string.concat(".bonds[", vm.toString(i), "]")); ++i) {
            string memory k = string.concat(".bonds[", vm.toString(i), "]");
            Env memory p;
            p.name = vm.parseJsonString(j, string.concat(k, ".name"));
            p.symbol = vm.parseJsonString(j, string.concat(k, ".symbol"));
            p.isin = vm.parseJsonString(j, string.concat(k, ".isin"));
            p.issuer = vm.parseJsonAddress(j, string.concat(k, ".issuer"));
            p.supply = vm.parseJsonUint(j, string.concat(k, ".supply"));
            p.maturity = vm.parseJsonUint(j, string.concat(k, ".maturityDate"));
            arr = string.concat(arr, i == 0 ? "" : ",", _entry(vm.parseJsonAddress(j, string.concat(k, ".token")), p));
        }
        arr = string.concat(arr, bytes(arr).length == 1 ? "" : ",", _entry(token, e), "]");
        vm.writeJson(arr, CFG, ".bonds");
    }

    function _entry(address token, Env memory e) internal returns (string memory) {
        string memory b = string.concat("bonds.", e.symbol);
        vm.serializeAddress(b, "token", token);
        vm.serializeString(b, "name", e.name);
        vm.serializeString(b, "symbol", e.symbol);
        vm.serializeString(b, "isin", e.isin);
        vm.serializeAddress(b, "issuer", e.issuer);
        vm.serializeUint(b, "supply", e.supply);
        return vm.serializeUint(b, "maturityDate", e.maturity);
    }

    /// @notice Encoding proof without a chain: builds the calldata and checks selector 0x29002951 + the ISIN.
    function dryRun() external view {
        if (!_luhn(ISIN)) revert BadIsin(ISIN);
        Env memory e;
        (e.issuer, e.officer, e.maturity, e.name, e.symbol, e.isin) =
            (address(0x15), address(0x0F), block.timestamp + 365 days, NAME, SYMBOL, ISIN);
        (IATSFactory.BondData memory data, IATSFactory.FactoryRegulationData memory reg) =
            _bond(address(0xB1), e, block.timestamp);
        bytes memory cd = abi.encodeCall(IATSFactory.deployBond, (data, reg));
        if (bytes4(cd) != IATSFactory.deployBond.selector || bytes4(cd) != 0x29002951) revert Unexpected("selector");
        console.log("deployBond selector: %s", vm.toString(abi.encodePacked(bytes4(cd))));
        console.log("calldata bytes:      %s", cd.length);
        console.log("rbacs:               %s", data.security.rbacs.length);
    }

    /// @dev Positional construction in `IATSFactory` (= ATS IFactory.sol @ be4f860e408e) field order.
    function _bond(address blr, Env memory e, uint256 start)
        internal
        pure
        returns (IATSFactory.BondData memory data, IATSFactory.FactoryRegulationData memory reg)
    {
        (address issuer, address officer) = (e.issuer, e.officer);
        IATSFactory.Rbac[] memory rbacs = new IATSFactory.Rbac[](9);
        rbacs[0] = IATSFactory.Rbac(DEFAULT_ADMIN_ROLE, _one(issuer));
        rbacs[1] = IATSFactory.Rbac(ROLE_SSI_MANAGER, _one(issuer));
        rbacs[2] = IATSFactory.Rbac(ROLE_KYC, _two(officer, issuer));
        rbacs[3] = IATSFactory.Rbac(ROLE_ISSUER, _one(issuer));
        rbacs[4] = IATSFactory.Rbac(ROLE_FREEZE_MANAGER, _one(officer));
        rbacs[5] = IATSFactory.Rbac(ROLE_PAUSER, _one(officer));
        rbacs[6] = IATSFactory.Rbac(ROLE_CONTROLLER, _one(issuer));
        rbacs[7] = IATSFactory.Rbac(ROLE_CORPORATE_ACTION, _one(issuer));
        rbacs[8] = IATSFactory.Rbac(ROLE_INTEREST_RATE_MANAGER, _one(issuer));

        data = IATSFactory.BondData({
            security: IATSFactory.SecurityData({
                resolver: blr,
                maxSupply: 1_000_000,
                resolverProxyConfiguration: IATSFactory.ResolverProxyConfiguration(BOND_CONFIG_ID, 1),
                erc20MetadataInfo: IATSFactory.ERC20MetadataInfo(e.name, e.symbol, e.isin, 0),
                rbacs: rbacs,
                externalPauses: new address[](0),
                externalControlLists: new address[](0),
                externalKycLists: new address[](0),
                compliance: address(0),
                identityRegistry: address(0),
                arePartitionsProtected: false,
                isMultiPartition: false,
                isControllable: true,
                isWhiteList: false,
                clearingActive: false,
                internalKycActivated: true,
                erc20VotesActivated: false
            }),
            bondDetails: IATSFactory.BondDetailsData("USD", 1, 0, start, e.maturity),
            proceedRecipients: new address[](0),
            proceedRecipientsData: new bytes[](0)
        });
        // REG_S = 1 with sub-type NONE = 0 is the only valid Reg S pair (constants/regulation.sol)
        reg = IATSFactory.FactoryRegulationData(1, 0, IATSFactory.AdditionalSecurityData(false, "", "Bond Desk demo"));
    }

    /// @dev ISIN Luhn: letters expand to 10..35, then mod-10 check over the digit string (check digit included).
    function _luhn(string memory isin) internal pure returns (bool) {
        bytes memory s = bytes(isin);
        if (s.length != 12) return false;
        uint8[24] memory d;
        uint256 n;
        for (uint256 i; i < 12; ++i) {
            uint8 c = uint8(s[i]);
            if (c >= 0x30 && c <= 0x39) {
                d[n++] = c - 0x30;
            } else if (c >= 0x41 && c <= 0x5A) {
                uint8 v = c - 0x41 + 10;
                d[n++] = v / 10;
                d[n++] = v % 10;
            } else {
                return false;
            }
        }
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            uint256 v = d[n - 1 - i];
            if (i % 2 == 1) {
                v *= 2;
                if (v > 9) v -= 9;
            }
            sum += v;
        }
        return sum % 10 == 0;
    }

    function _one(address a) internal pure returns (address[] memory m) {
        m = new address[](1);
        m[0] = a;
    }

    function _two(address a, address b) internal pure returns (address[] memory m) {
        m = new address[](2);
        m[0] = a;
        m[1] = b;
    }
}
