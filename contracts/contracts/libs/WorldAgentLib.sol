// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WorldTypes} from "./WorldTypes.sol";
import {WorldStateLib} from "./WorldStateLib.sol";
import {WorldChronicleLib} from "./WorldChronicleLib.sol";
import {SomniaNativeAgentsLib} from "./SomniaNativeAgentsLib.sol";
import "../interfaces/ISomniaAgents.sol";

library WorldAgentLib {
    struct Storage {
        mapping(uint256 => bytes32) pendingAgentDecisions;
        mapping(uint256 => bool) pendingChronicle;
        mapping(uint256 => bool) pendingToolsChat;
    }

    event AgentDecisionRequested(uint256 indexed requestId, bytes32 indexed triggerId);
    event AgentDecisionReceived(uint256 indexed requestId, string result);

    error UnknownRequest();

    function requestAgentDecision(
        Storage storage self,
        WorldStateLib.Storage storage state,
        WorldTypes.WorldConfig storage config,
        bytes32 triggerId,
        string memory prompt,
        string memory system,
        string[] memory allowedValues,
        uint256 cooldownSeconds,
        bytes4 callbackSelector
    ) internal returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            system,
            false,
            allowedValues
        );

        requestId = SomniaNativeAgentsLib.requestNativeAgent(
            state,
            config,
            SomniaNativeAgentsLib.NativeAgentType.LLM,
            payload,
            triggerId,
            cooldownSeconds,
            callbackSelector,
            SomniaNativeAgentsLib.AgentRequestOptions({
                subcommitteeSize: 0,
                threshold: 0,
                consensusType: config.defaultConsensusType,
                timeout: 0
            })
        );

        self.pendingAgentDecisions[requestId] = triggerId;
        emit AgentDecisionRequested(requestId, triggerId);
    }

    function requestToolsChatDecision(
        Storage storage self,
        WorldStateLib.Storage storage state,
        WorldTypes.WorldConfig storage config,
        bytes32 triggerId,
        string[] memory roles,
        string[] memory messages,
        string[] memory mcpServerUrls,
        uint256 cooldownSeconds,
        bytes4 callbackSelector
    ) internal returns (uint256 requestId) {
        ILLMAgent.OnchainTool[] memory onchainTools = new ILLMAgent.OnchainTool[](0);
        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferToolsChat.selector,
            roles,
            messages,
            mcpServerUrls,
            onchainTools,
            uint256(8),
            false
        );

        requestId = SomniaNativeAgentsLib.requestNativeAgent(
            state,
            config,
            SomniaNativeAgentsLib.NativeAgentType.LLM,
            payload,
            triggerId,
            cooldownSeconds,
            callbackSelector,
            SomniaNativeAgentsLib.AgentRequestOptions({
                subcommitteeSize: 0,
                threshold: 0,
                consensusType: config.defaultConsensusType,
                timeout: 0
            })
        );

        self.pendingAgentDecisions[requestId] = triggerId;
        self.pendingToolsChat[requestId] = true;
        emit AgentDecisionRequested(requestId, triggerId);
    }

    function handleAgentResponse(
        Storage storage self,
        WorldStateLib.Storage storage state,
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status
    ) internal {
        bytes32 triggerId = self.pendingAgentDecisions[requestId];
        if (triggerId == bytes32(0)) revert UnknownRequest();
        delete self.pendingAgentDecisions[requestId];
        bool isToolsChat = self.pendingToolsChat[requestId];
        if (isToolsChat) {
            delete self.pendingToolsChat[requestId];
        }

        if (status == ResponseStatus.Success && responses.length > 0) {
            string memory result;
            if (isToolsChat) {
                (
                    string memory finishReason,
                    string memory response,
                    string[] memory updatedRoles,
                    string[] memory updatedMessages,
                    string[] memory pendingToolCallIds,
                    bytes[] memory pendingToolCalls
                ) = abi.decode(
                    responses[0].result,
                    (string, string, string[], string[], string[], bytes[])
                );
                finishReason;
                updatedRoles;
                updatedMessages;
                pendingToolCallIds;
                pendingToolCalls;
                result = response;
            } else {
                result = abi.decode(responses[0].result, (string));
            }

            if (self.pendingChronicle[requestId]) {
                delete self.pendingChronicle[requestId];
                uint256 index = WorldChronicleLib.recordFromAgent(state, result, requestId);
                WorldChronicleLib.emitChronicle(index, result);
            } else {
                WorldStateLib.pushEvent(state, "agent_decision", result, requestId);
            }

            emit AgentDecisionReceived(requestId, result);
        }
    }

    function markChroniclePending(Storage storage self, uint256 requestId) internal {
        self.pendingChronicle[requestId] = true;
    }
}
