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
    uint256 private constant FALLBACK_LLM_RUNNER_PRICE = 70_000_000_000_000_000;
    uint256 private constant FALLBACK_JSON_RUNNER_PRICE = 30_000_000_000_000_000;
    uint256 private constant FALLBACK_WEB_PARSE_RUNNER_PRICE = 100_000_000_000_000_000;
    uint256 private constant FALLBACK_FIXED_BUFFER = 50_000_000_000_000_000;
    uint256 private constant FALLBACK_BUFFER_BPS = 10_000;

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

        (, , , , uint256 requiredBudget) = calculateRequestBudget(config, agent, size);
        uint256 valToSend = msg.value > 0 ? msg.value : requiredBudget;
        if (valToSend < requiredBudget) {
            revert InsufficientBalance();
        }
        if (msg.value == 0 && address(this).balance < valToSend) {
            revert InsufficientBalance();
        }

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

    function calculateRequestBudget(
        WorldTypes.WorldConfig storage config,
        NativeAgentType agent,
        uint256 subcommitteeSize
    )
        internal
        view
        returns (
            uint256 platformDeposit,
            uint256 runnerFee,
            uint256 fixedBuffer,
            uint256 percentBuffer,
            uint256 totalBudget
        )
    {
        uint256 size = subcommitteeSize == 0 ? config.subcommitteeSize : subcommitteeSize;
        IAgentRequester platform;

        if (agent == NativeAgentType.LLM) {
            platform = IAgentRequester(config.llmPlatform);
            runnerFee = FALLBACK_LLM_RUNNER_PRICE * size;
        } else if (agent == NativeAgentType.JsonApi) {
            platform = IAgentRequester(config.jsonPlatform);
            runnerFee = FALLBACK_JSON_RUNNER_PRICE * size;
        } else {
            platform = IAgentRequester(config.jsonPlatform);
            runnerFee = FALLBACK_WEB_PARSE_RUNNER_PRICE * size;
        }

        platformDeposit = platform.getAdvancedRequestDeposit(size);
        fixedBuffer = FALLBACK_FIXED_BUFFER;
        uint256 base = platformDeposit + runnerFee;
        percentBuffer = (base * FALLBACK_BUFFER_BPS) / 10_000;
        totalBudget = base + fixedBuffer + percentBuffer;
    }
}
