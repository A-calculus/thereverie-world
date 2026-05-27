// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "../interfaces/ISomniaAgents.sol";

/**
 * @title WorldTypes
 * @dev Shared structs for REVERIE world facade + libraries (testnet).
 */
library WorldTypes {
    struct WorldConfig {
        address llmPlatform;
        address jsonPlatform;
        uint256 llmAgentId;
        uint256 jsonAgentId;
        uint256 webParseAgentId;
        uint256 subcommitteeSize;
        ConsensusType defaultConsensusType;
        uint256 defaultThreshold;
        uint256 defaultTimeout;
    }

    struct Zone {
        string name;
        uint256 dangerLevel;
        string controllingFaction;
        string climateState;
    }

    struct WorldEvent {
        uint256 timestamp;
        string eventType;
        string description;
        uint256 requestId;
    }

    struct FactionMorale {
        int256 moraleDelta;
        string narrative;
        uint256 updatedAt;
    }
}
