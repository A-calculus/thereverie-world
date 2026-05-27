// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WorldTypes} from "./WorldTypes.sol";
import {WorldStateLib} from "./WorldStateLib.sol";
import {SomniaNativeAgentsLib} from "./SomniaNativeAgentsLib.sol";
import "../interfaces/ISomniaAgents.sol";

library WorldDataOracleLib {
    struct Storage {
        mapping(uint256 => bytes32) pendingJsonOracle;
        mapping(uint256 => bytes32) pendingWebParse;
    }

    event JsonOracleRequested(uint256 indexed requestId, bytes32 indexed triggerId);
    event JsonOracleReceived(uint256 indexed requestId, string result);

    error UnknownRequest();

    function requestJsonOracle(
        Storage storage self,
        WorldStateLib.Storage storage state,
        WorldTypes.WorldConfig storage config,
        bytes32 triggerId,
        string calldata url,
        string calldata selector,
        uint256 cooldownSeconds,
        bytes4 callbackSelector
    ) internal returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchString.selector,
            url,
            selector
        );

        requestId = SomniaNativeAgentsLib.requestNativeAgent(
            state,
            config,
            SomniaNativeAgentsLib.NativeAgentType.JsonApi,
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

        self.pendingJsonOracle[requestId] = triggerId;
        emit JsonOracleRequested(requestId, triggerId);
    }

    function requestWebParse(
        Storage storage self,
        WorldStateLib.Storage storage state,
        WorldTypes.WorldConfig storage config,
        bytes32 triggerId,
        bytes calldata payload,
        uint256 cooldownSeconds,
        bytes4 callbackSelector
    ) internal returns (uint256 requestId) {
        requestId = SomniaNativeAgentsLib.requestNativeAgent(
            state,
            config,
            SomniaNativeAgentsLib.NativeAgentType.WebParse,
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

        self.pendingWebParse[requestId] = triggerId;
        emit JsonOracleRequested(requestId, triggerId);
    }

    function handleJsonResponse(
        Storage storage self,
        WorldStateLib.Storage storage state,
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status
    ) internal {
        bytes32 triggerId = self.pendingJsonOracle[requestId];
        if (triggerId != bytes32(0)) {
            delete self.pendingJsonOracle[requestId];
        } else {
            triggerId = self.pendingWebParse[requestId];
            if (triggerId == bytes32(0)) revert UnknownRequest();
            delete self.pendingWebParse[requestId];
        }

        if (status == ResponseStatus.Success && responses.length > 0) {
            string memory result = abi.decode(responses[0].result, (string));
            WorldStateLib.pushEvent(state, "json_oracle", result, requestId);
            emit JsonOracleReceived(requestId, result);
        }
    }
}
