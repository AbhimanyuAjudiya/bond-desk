// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice ABI-exact subset of ATS `IFactory` (packages/ats/contracts/contracts/factory/IFactory.sol @ be4f860e408e).
/// @dev Flattened without changing encoding or selectors: `IBusinessLogicResolver` -> address;
///      `ICore.ERC20MetadataInfo` and `IResolverProxy.Rbac` inlined; `RegulationType` / `RegulationSubType`
///      enums (constants/regulation.sol) -> uint8. Field order is verbatim.
interface IATSFactory {
    struct ResolverProxyConfiguration {
        bytes32 key;
        uint256 version;
    }

    /// @dev facets/core/ICore.sol
    struct ERC20MetadataInfo {
        string name;
        string symbol;
        string isin;
        uint8 decimals;
    }

    /// @dev infrastructure/proxy/IResolverProxy.sol
    struct Rbac {
        bytes32 role;
        address[] members;
    }

    struct SecurityData {
        address resolver;
        uint256 maxSupply;
        ResolverProxyConfiguration resolverProxyConfiguration;
        ERC20MetadataInfo erc20MetadataInfo;
        Rbac[] rbacs;
        address[] externalPauses;
        address[] externalControlLists;
        address[] externalKycLists;
        address compliance;
        address identityRegistry;
        bool arePartitionsProtected;
        bool isMultiPartition;
        bool isControllable;
        bool isWhiteList;
        bool clearingActive;
        bool internalKycActivated;
        bool erc20VotesActivated;
    }

    struct BondDetailsData {
        bytes3 currency;
        uint256 nominalValue;
        uint8 nominalValueDecimals;
        uint256 startingDate;
        uint256 maturityDate;
    }

    struct BondData {
        SecurityData security;
        BondDetailsData bondDetails;
        address[] proceedRecipients;
        bytes[] proceedRecipientsData;
    }

    /// @dev constants/regulation.sol
    struct AdditionalSecurityData {
        bool countriesControlListType;
        string listOfCountries;
        string info;
    }

    /// @dev constants/regulation.sol. regulationType: 0 NONE, 1 REG_S, 2 REG_D;
    ///      regulationSubType: 0 NONE, 1 REG_D_506_B, 2 REG_D_506_C.
    struct FactoryRegulationData {
        uint8 regulationType;
        uint8 regulationSubType;
        AdditionalSecurityData additionalSecurityData;
    }

    event BondDeployed(
        address indexed deployer, address bondAddress, BondData bondData, FactoryRegulationData regulationData
    );

    error EmptyResolver(address resolver);
    error NoInitialAdmins();
    error WrongISIN(string isin);
    error WrongISINChecksum(string isin);
    error RegulationTypeAndSubTypeForbidden(uint8 regulationType, uint8 regulationSubType);

    function deployBond(BondData calldata bondData, FactoryRegulationData calldata regulationData)
        external
        returns (address bondAddress);
}
