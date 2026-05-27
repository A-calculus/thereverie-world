// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WorldTypes} from "./WorldTypes.sol";
import {WorldStateLib} from "./WorldStateLib.sol";
import "../interfaces/ISomniaAgents.sol";

/**
 * @title SomniaNativeAgentsLib
 * @dev Unified router for Somnia's 3 native agents (LLM, JSON API, Web Parse).
 */
library SomniaNativeAgentsLib {
    enum NativeAgentType {
        LLM,
        JsonApi,
        WebParse
    }

    struct AgentRequestOptions {
        uint256 subcommitteeSize;
        uint256 threshold;
        ConsensusType consensusType;
        uint256 timeout;
    }

    event NativeAgentRequested(
        uint256 indexed requestId,
        NativeAgentType indexed agent,
        bytes32 indexed triggerId
    );

    error CooldownActive();
    error InsufficientBalance();

    function requestNativeAgent(
        WorldStateLib.Storage storage state,
        WorldTypes.WorldConfig storage config,
        NativeAgentType agent,
        bytes memory payload,
        bytes32 triggerId,
        uint256 cooldownSeconds,
        bytes4 callbackSelector,
        AgentRequestOptions memory opts
    ) internal returns (uint256 requestId) {
        if (cooldownSeconds > 0) {
            WorldStateLib.checkCooldown(state, triggerId, cooldownSeconds);
        }

        uint256 size = opts.subcommitteeSize == 0 ? config.subcommitteeSize : opts.subcommitteeSize;
        uint256 threshold = opts.threshold == 0 ? config.defaultThreshold : opts.threshold;
        if (threshold == 0) {
            threshold = size / 2 + 1;
        }
        ConsensusType consensus = opts.consensusType;
        uint256 timeout = opts.timeout == 0 ? config.defaultTimeout : opts.timeout;

        IAgentRequester platform;
        uint256 agentId;

        if (agent == NativeAgentType.LLM) {
            platform = IAgentRequester(config.llmPlatform);
            agentId = config.llmAgentId;
        } else if (agent == NativeAgentType.JsonApi) {
            platform = IAgentRequester(config.jsonPlatform);
            agentId = config.jsonAgentId;
        } else {
            platform = IAgentRequester(config.jsonPlatform);
            agentId = config.webParseAgentId;
        }

        uint256 deposit = platform.getAdvancedRequestDeposit(size);
        if (address(this).balance < deposit && msg.value < deposit) {
            revert InsufficientBalance();
        }
        uint256 valToSend = msg.value > 0 ? msg.value : deposit;

        requestId = platform.createAdvancedRequest{value: valToSend}(
            agentId,
            address(this),
            callbackSelector,
            payload,
            size,
            threshold,
            consensus,
            timeout
        );

        emit NativeAgentRequested(requestId, agent, triggerId);
    }
}
