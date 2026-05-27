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
    }

    event AgentDecisionRequested(uint256 indexed requestId, bytes32 indexed triggerId);
    event AgentDecisionReceived(uint256 indexed requestId, string result);

    error UnknownRequest();

    function requestAgentDecision(
        Storage storage self,
        WorldStateLib.Storage storage state,
        WorldTypes.WorldConfig storage config,
        bytes32 triggerId,
        string calldata prompt,
        string calldata system,
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

        if (status == ResponseStatus.Success && responses.length > 0) {
            string memory result = abi.decode(responses[0].result, (string));

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
