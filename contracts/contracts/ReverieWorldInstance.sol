// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./interfaces/ISomniaAgents.sol";
import {WorldTypes} from "./libs/WorldTypes.sol";
import {WorldStateLib} from "./libs/WorldStateLib.sol";
import {WorldAgentLib} from "./libs/WorldAgentLib.sol";
import {WorldDataOracleLib} from "./libs/WorldDataOracleLib.sol";
import {WorldChronicleLib} from "./libs/WorldChronicleLib.sol";
import {SomniaNativeAgentsLib} from "./libs/SomniaNativeAgentsLib.sol";
import {ReactivityLib} from "./libs/ReactivityLib.sol";

/**
 * @title ReverieWorldInstance
 * @dev Facade for a single REVERIE autonomous world (Somnia testnet).
 */
contract ReverieWorldInstance is Initializable, OwnableUpgradeable, SomniaEventHandler {
    bytes32 private constant ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    WorldTypes.WorldConfig public config;

    WorldStateLib.Storage private _state;
    WorldAgentLib.Storage private _agent;
    WorldDataOracleLib.Storage private _oracle;

    mapping(uint256 => uint256) public reactivitySubscriptions;
    mapping(bytes32 => address) private _modules;
    mapping(address => uint256) private _moduleInstallCounts;

    // Lifecycle: 0 draft, 1 configured/deployed, 2 armed, 3 running, 4 paused, 5 stopped.
    uint8 public lifecycleStatus;
    bytes32 public manifestHash;

    struct ManifestZoneInput {
        bytes32 zoneId;
        string name;
        uint256 dangerLevel;
        string faction;
    }

    struct ManifestFactionInput {
        string factionId;
        string name;
        int256 morale;
        string narrative;
    }

    struct ManifestTriggerInput {
        bytes32 triggerId;
        bool active;
        uint8 triggerType;
        address emitter;
        bytes32 topic0;
        bytes32 topic1;
        uint64 gasLimit;
        uint256 cooldownSeconds;
        uint256 scheduleIntervalSeconds;
        uint256 scheduleNextTimestampMs;
        uint256 firstStep;
        uint256 stepCount;
    }

    struct ManifestStepInput {
        uint8 kind;
        bytes32 zoneId;
        string factionId;
        string prompt;
        string system;
        string url;
        string selector;
        bytes payload;
    }

    struct ManifestContinuationInput {
        bytes32 triggerId;
        string matchValue;
        bytes32 nextTriggerId;
        bool terminal;
    }

    struct ManifestTrigger {
        bool exists;
        bool active;
        uint8 triggerType;
        address emitter;
        bytes32 topic0;
        bytes32 topic1;
        uint64 gasLimit;
        uint256 cooldownSeconds;
        uint256 scheduleIntervalSeconds;
        uint256 scheduleNextTimestampMs;
        uint256 firstStep;
        uint256 stepCount;
        uint256 subscriptionId;
        uint256 lastFiredAt;
    }

    struct ManifestStep {
        uint8 kind;
        bytes32 zoneId;
        string factionId;
        string prompt;
        string system;
        string url;
        string selector;
        bytes payload;
    }

    struct ManifestContinuation {
        string matchValue;
        bytes32 nextTriggerId;
        bool terminal;
    }

    struct PendingWorkflow {
        bool exists;
        bytes32 triggerId;
        uint256 nextStep;
        uint256 endStep;
    }

    bytes32[] private _manifestZoneIds;
    string[] private _manifestFactionIds;
    bytes32[] private _manifestTriggerIds;
    ManifestStep[] private _manifestSteps;
    mapping(bytes32 => ManifestTrigger) private _manifestTriggers;
    mapping(bytes32 => ManifestContinuation[]) private _manifestContinuations;
    mapping(uint256 => bytes32) private _subscriptionToTrigger;
    mapping(uint256 => PendingWorkflow) private _pendingWorkflows;
    uint256 private _continuationDepth;

    uint256 private constant MAX_CONTINUATION_DEPTH = 4;

    error PlatformOnly();
    error InvalidManifest();
    error TriggerNotFound(bytes32 triggerId);
    error TriggerInactive(bytes32 triggerId);
    error UnsupportedWorkflowStep(uint8 kind);

    event TriggerFired(bytes32 indexed triggerId, string context);
    event ReactivitySubscribed(uint256 indexed subscriptionId, bytes32 eventSig);
    event ManifestConfigured(bytes32 indexed manifestHash, uint256 zoneCount, uint256 factionCount, uint256 triggerCount, uint256 stepCount);
    event LifecycleStatusChanged(uint8 indexed status, string reason);
    event ManifestTriggerSubscribed(bytes32 indexed triggerId, uint256 indexed subscriptionId, address indexed emitter, bytes32 topic0);
    event ManifestTriggerUnsubscribed(bytes32 indexed triggerId, uint256 indexed subscriptionId);
    event WorkflowStepRequested(bytes32 indexed triggerId, uint256 indexed stepIndex, uint8 indexed kind, uint256 requestId);
    event WorkflowCompleted(bytes32 indexed triggerId, string result);
    event DecisionContinuationMatched(
        bytes32 indexed triggerId,
        bytes32 indexed nextTriggerId,
        string matchValue,
        bool terminal
    );
    event Upgraded(address indexed implementation);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner, WorldTypes.WorldConfig memory _config) external initializer {
        __Ownable_init(_owner);
        config = _config;
    }

    receive() external payable {}

    // ─── Manifest lifecycle ─────────────────────────────────────────────────

    function configureManifest(
        bytes32 _manifestHash,
        ManifestZoneInput[] calldata zones_,
        ManifestFactionInput[] calldata factions_,
        ManifestTriggerInput[] calldata triggers_,
        ManifestStepInput[] calldata steps_,
        ManifestContinuationInput[] calldata continuations_
    ) external onlyOwner {
        for (uint256 i = 0; i < _manifestTriggerIds.length; i++) {
            bytes32 triggerId = _manifestTriggerIds[i];
            uint256 subscriptionId = _manifestTriggers[triggerId].subscriptionId;
            if (subscriptionId != 0) {
                ReactivityLib.unsubscribe(subscriptionId);
                delete reactivitySubscriptions[subscriptionId];
                delete _subscriptionToTrigger[subscriptionId];
            }
            delete _manifestContinuations[triggerId];
            delete _manifestTriggers[triggerId];
        }
        delete _manifestTriggerIds;
        delete _manifestZoneIds;
        delete _manifestFactionIds;
        delete _manifestSteps;

        manifestHash = _manifestHash;

        for (uint256 i = 0; i < zones_.length; i++) {
            _manifestZoneIds.push(zones_[i].zoneId);
            WorldStateLib.setZone(
                _state,
                zones_[i].zoneId,
                zones_[i].name,
                zones_[i].dangerLevel,
                zones_[i].faction
            );
        }

        for (uint256 i = 0; i < factions_.length; i++) {
            _manifestFactionIds.push(factions_[i].factionId);
            WorldStateLib.updateFactionMorale(
                _state,
                factions_[i].factionId,
                factions_[i].morale,
                factions_[i].narrative
            );
        }

        for (uint256 i = 0; i < steps_.length; i++) {
            _manifestSteps.push(ManifestStep({
                kind: steps_[i].kind,
                zoneId: steps_[i].zoneId,
                factionId: steps_[i].factionId,
                prompt: steps_[i].prompt,
                system: steps_[i].system,
                url: steps_[i].url,
                selector: steps_[i].selector,
                payload: steps_[i].payload
            }));
        }

        for (uint256 i = 0; i < triggers_.length; i++) {
            ManifestTriggerInput calldata t = triggers_[i];
            if (t.triggerId == bytes32(0) || t.firstStep + t.stepCount > steps_.length) {
                revert InvalidManifest();
            }
            _manifestTriggerIds.push(t.triggerId);
            _manifestTriggers[t.triggerId] = ManifestTrigger({
                exists: true,
                active: t.active,
                triggerType: t.triggerType,
                emitter: t.emitter,
                topic0: t.topic0,
                topic1: t.topic1,
                gasLimit: t.gasLimit,
                cooldownSeconds: t.cooldownSeconds,
                scheduleIntervalSeconds: t.scheduleIntervalSeconds,
                scheduleNextTimestampMs: t.scheduleNextTimestampMs,
                firstStep: t.firstStep,
                stepCount: t.stepCount,
                subscriptionId: 0,
                lastFiredAt: 0
            });
        }

        for (uint256 i = 0; i < continuations_.length; i++) {
            ManifestContinuationInput calldata c = continuations_[i];
            if (c.triggerId == bytes32(0) || !_manifestTriggers[c.triggerId].exists) {
                revert InvalidManifest();
            }
            if (!c.terminal && (c.nextTriggerId == bytes32(0) || !_manifestTriggers[c.nextTriggerId].exists)) {
                revert InvalidManifest();
            }
            _manifestContinuations[c.triggerId].push(ManifestContinuation({
                matchValue: c.matchValue,
                nextTriggerId: c.nextTriggerId,
                terminal: c.terminal
            }));
        }

        lifecycleStatus = 1;
        emit ManifestConfigured(_manifestHash, zones_.length, factions_.length, triggers_.length, steps_.length);
        emit LifecycleStatusChanged(lifecycleStatus, "manifest_configured");
    }

    function armWorld() external onlyOwner {
        lifecycleStatus = 2;
        emit LifecycleStatusChanged(lifecycleStatus, "armed");
    }

    function pauseWorld() external onlyOwner {
        lifecycleStatus = 4;
        emit LifecycleStatusChanged(lifecycleStatus, "paused");
    }

    function stopWorld(string calldata reason) external onlyOwner {
        lifecycleStatus = 5;
        emit LifecycleStatusChanged(lifecycleStatus, reason);
    }

    function fireManualTrigger(bytes32 triggerId, string calldata context) external payable onlyOwner {
        _fireManifestTrigger(triggerId, context);
    }

    function getManifestCounts()
        external
        view
        returns (uint256 zoneCount, uint256 factionCount, uint256 triggerCount, uint256 stepCount)
    {
        return (_manifestZoneIds.length, _manifestFactionIds.length, _manifestTriggerIds.length, _manifestSteps.length);
    }

    function getManifestTrigger(bytes32 triggerId)
        external
        view
        returns (
            bool active,
            uint8 triggerType,
            address emitter,
            bytes32 topic0,
            bytes32 topic1,
            uint64 gasLimit,
            uint256 cooldownSeconds,
            uint256 scheduleIntervalSeconds,
            uint256 scheduleNextTimestampMs,
            uint256 firstStep,
            uint256 stepCount,
            uint256 subscriptionId,
            uint256 lastFiredAt
        )
    {
        ManifestTrigger storage t = _manifestTriggers[triggerId];
        if (!t.exists) revert TriggerNotFound(triggerId);
        return (
            t.active,
            t.triggerType,
            t.emitter,
            t.topic0,
            t.topic1,
            t.gasLimit,
            t.cooldownSeconds,
            t.scheduleIntervalSeconds,
            t.scheduleNextTimestampMs,
            t.firstStep,
            t.stepCount,
            t.subscriptionId,
            t.lastFiredAt
        );
    }

    // ─── Zone & faction state ────────────────────────────────────────────────

    function setZone(
        bytes32 zoneId,
        string calldata name,
        uint256 dangerLevel,
        string calldata faction
    ) external onlyOwner {
        WorldStateLib.setZone(_state, zoneId, name, dangerLevel, faction);
    }

    function zones(bytes32 zoneId)
        external
        view
        returns (string memory name, uint256 dangerLevel, string memory controllingFaction, string memory climateState)
    {
        WorldTypes.Zone storage z = _state.zones[zoneId];
        return (z.name, z.dangerLevel, z.controllingFaction, z.climateState);
    }

    function eventHistory(uint256 index)
        external
        view
        returns (uint256 timestamp, string memory eventType, string memory description, uint256 requestId)
    {
        WorldTypes.WorldEvent storage e = _state.eventHistory[index];
        return (e.timestamp, e.eventType, e.description, e.requestId);
    }

    function triggerCooldowns(bytes32 triggerId) external view returns (uint256) {
        return _state.triggerCooldowns[triggerId];
    }

    function factionMorale(string calldata factionId)
        external
        view
        returns (int256 moraleDelta, string memory narrative, uint256 updatedAt)
    {
        WorldTypes.FactionMorale storage m = _state.factionMorale[factionId];
        return (m.moraleDelta, m.narrative, m.updatedAt);
    }

    function applyClimateResult(bytes32 zoneId, string calldata climateState) external onlyOwner {
        WorldStateLib.applyClimateResult(_state, zoneId, climateState);
    }

    function applyConflictOutcome(bytes32 zoneId, string calldata outcome) external onlyOwner {
        WorldStateLib.applyConflictOutcome(_state, zoneId, outcome);
    }

    function updateFactionMorale(
        string calldata factionId,
        int256 moraleDelta,
        string calldata narrative
    ) external onlyOwner {
        WorldStateLib.updateFactionMorale(_state, factionId, moraleDelta, narrative);
    }

    // ─── Native agent requests (returns requestId for WSS tracking) ─────────

    function requestAgentDecision(
        bytes32 triggerId,
        string calldata prompt,
        string calldata system,
        string[] calldata allowedValues,
        uint256 cooldownSeconds
    ) external payable returns (uint256 requestId) {
        requestId = WorldAgentLib.requestAgentDecision(
            _agent,
            _state,
            config,
            triggerId,
            prompt,
            system,
            allowedValues,
            cooldownSeconds,
            this.handleAgentResponse.selector
        );
        emit TriggerFired(triggerId, prompt);
    }

    function requestLlmToolsChat(
        bytes32 triggerId,
        string[] calldata roles,
        string[] calldata messages,
        string[] calldata mcpServerUrls,
        uint256 cooldownSeconds
    ) external payable onlyOwner returns (uint256 requestId) {
        requestId = WorldAgentLib.requestToolsChatDecision(
            _agent,
            _state,
            config,
            triggerId,
            roles,
            messages,
            mcpServerUrls,
            cooldownSeconds,
            this.handleAgentResponse.selector
        );
        emit TriggerFired(triggerId, "llm_tools_chat");
    }

    function requestJsonOracle(
        bytes32 triggerId,
        string calldata url,
        string calldata selector,
        uint256 cooldownSeconds
    ) external payable returns (uint256 requestId) {
        requestId = WorldDataOracleLib.requestJsonOracle(
            _oracle,
            _state,
            config,
            triggerId,
            url,
            selector,
            cooldownSeconds,
            this.handleJsonOracleResponse.selector
        );
        emit TriggerFired(triggerId, url);
    }

    function requestWebParse(
        bytes32 triggerId,
        bytes calldata payload,
        uint256 cooldownSeconds
    ) external payable returns (uint256 requestId) {
        requestId = WorldDataOracleLib.requestWebParse(
            _oracle,
            _state,
            config,
            triggerId,
            payload,
            cooldownSeconds,
            this.handleJsonOracleResponse.selector
        );
        emit TriggerFired(triggerId, "web_parse");
    }

    function recordChronicleEntry(string calldata description) external onlyOwner {
        WorldChronicleLib.recordFromAgent(_state, description, 0);
    }

    function chronicleFromAgent(
        bytes32 triggerId,
        string calldata rawEvent,
        string calldata system,
        uint256 cooldownSeconds
    ) external payable onlyOwner returns (uint256 requestId) {
        requestId = WorldAgentLib.requestAgentDecision(
            _agent,
            _state,
            config,
            triggerId,
            rawEvent,
            system,
            new string[](0),
            cooldownSeconds,
            this.handleAgentResponse.selector
        );
        WorldAgentLib.markChroniclePending(_agent, requestId);
    }

    // ─── Reactivity (on-chain autonomous triggers) ───────────────────────────

    function subscribeToEvent(
        address emitter,
        bytes32 eventSig,
        uint64 gasLimit
    ) external onlyOwner returns (uint256 subscriptionId) {
        subscriptionId = ReactivityLib.subscribeToEmitter(
            address(this),
            emitter,
            eventSig,
            gasLimit
        );
        reactivitySubscriptions[subscriptionId] = subscriptionId;
        emit ReactivitySubscribed(subscriptionId, eventSig);
    }

    function subscribeTrigger(bytes32 triggerId) external onlyOwner returns (uint256 subscriptionId) {
        ManifestTrigger storage t = _manifestTriggers[triggerId];
        if (!t.exists) revert TriggerNotFound(triggerId);
        if (!t.active) revert TriggerInactive(triggerId);
        if ((t.triggerType != 2 && t.emitter == address(0)) || t.topic0 == bytes32(0)) revert InvalidManifest();
        if (t.subscriptionId != 0) return t.subscriptionId;

        uint64 gasLimit = t.gasLimit == 0 ? 500_000 : t.gasLimit;
        bytes32[4] memory topics = [t.topic0, t.topic1, bytes32(0), bytes32(0)];
        subscriptionId = ReactivityLib.subscribeWithTopics(address(this), t.emitter, topics, gasLimit);
        t.subscriptionId = subscriptionId;
        reactivitySubscriptions[subscriptionId] = subscriptionId;
        _subscriptionToTrigger[subscriptionId] = triggerId;
        emit ManifestTriggerSubscribed(triggerId, subscriptionId, t.emitter, t.topic0);
    }

    function unsubscribeFromEvent(uint256 subscriptionId) external onlyOwner {
        ReactivityLib.unsubscribe(subscriptionId);
        delete reactivitySubscriptions[subscriptionId];
    }

    function unsubscribeTrigger(bytes32 triggerId) external onlyOwner {
        ManifestTrigger storage t = _manifestTriggers[triggerId];
        if (!t.exists) revert TriggerNotFound(triggerId);
        uint256 subscriptionId = t.subscriptionId;
        if (subscriptionId == 0) return;
        ReactivityLib.unsubscribe(subscriptionId);
        t.subscriptionId = 0;
        delete reactivitySubscriptions[subscriptionId];
        delete _subscriptionToTrigger[subscriptionId];
        emit ManifestTriggerUnsubscribed(triggerId, subscriptionId);
    }

    // ─── Platform callbacks ──────────────────────────────────────────────────

    function handleAgentResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        if (msg.sender != config.llmPlatform) revert PlatformOnly();
        string memory result = _firstSuccessfulString(responses);
        WorldAgentLib.handleAgentResponse(_agent, _state, requestId, responses, status);
        _continueManifestWorkflow(requestId, status, result);
    }

    function handleJsonOracleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external {
        if (msg.sender != config.jsonPlatform) revert PlatformOnly();
        string memory result = _firstSuccessfulString(responses);
        WorldDataOracleLib.handleJsonResponse(_oracle, _state, requestId, responses, status);
        _continueManifestWorkflow(requestId, status, result);
    }

    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        if (eventTopics.length == 0) return;
        for (uint256 i = 0; i < _manifestTriggerIds.length; i++) {
            bytes32 triggerId = _manifestTriggerIds[i];
            ManifestTrigger storage t = _manifestTriggers[triggerId];
            bool topic1Matches = t.topic1 == bytes32(0) || (eventTopics.length > 1 && t.topic1 == eventTopics[1]);
            bool emitterMatches = t.triggerType == 2 || t.emitter == emitter;
            if (t.active && emitterMatches && t.topic0 == eventTopics[0] && topic1Matches) {
                if (t.triggerType == 2 && t.scheduleIntervalSeconds > 0) {
                    _resubscribeSchedule(triggerId, t);
                }
                _fireManifestTrigger(triggerId, "reactivity_event");
            }
        }
        data;
    }

    function _resubscribeSchedule(bytes32 triggerId, ManifestTrigger storage t) internal {
        if (t.subscriptionId != 0) {
            delete reactivitySubscriptions[t.subscriptionId];
            delete _subscriptionToTrigger[t.subscriptionId];
        }
        uint256 nextTimestampMs = (block.timestamp + t.scheduleIntervalSeconds) * 1000;
        t.scheduleNextTimestampMs = nextTimestampMs;
        t.topic1 = bytes32(uint256(nextTimestampMs));
        uint64 gasLimit = t.gasLimit == 0 ? 500_000 : t.gasLimit;
        bytes32[4] memory topics = [t.topic0, t.topic1, bytes32(0), bytes32(0)];
        uint256 subscriptionId = ReactivityLib.subscribeWithTopics(address(this), t.emitter, topics, gasLimit);
        t.subscriptionId = subscriptionId;
        reactivitySubscriptions[subscriptionId] = subscriptionId;
        _subscriptionToTrigger[subscriptionId] = triggerId;
        emit ManifestTriggerSubscribed(triggerId, subscriptionId, t.emitter, t.topic0);
    }

    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    function _fireManifestTrigger(bytes32 triggerId, string memory context) internal {
        ManifestTrigger storage t = _manifestTriggers[triggerId];
        if (!t.exists) revert TriggerNotFound(triggerId);
        if (!t.active) revert TriggerInactive(triggerId);
        if (t.cooldownSeconds > 0 && block.timestamp < t.lastFiredAt + t.cooldownSeconds) {
            return;
        }
        if (lifecycleStatus == 2) {
            lifecycleStatus = 3;
            emit LifecycleStatusChanged(lifecycleStatus, "trigger_started_world");
        }
        t.lastFiredAt = block.timestamp;
        emit TriggerFired(triggerId, context);
        _runManifestStep(triggerId, t.firstStep, t.firstStep + t.stepCount, "");
    }

    function _runManifestStep(
        bytes32 triggerId,
        uint256 stepIndex,
        uint256 endStep,
        string memory previousResult
    ) internal {
        if (stepIndex >= endStep) {
            emit WorkflowCompleted(triggerId, previousResult);
            _dispatchDecisionContinuation(triggerId, previousResult);
            return;
        }

        ManifestStep storage step = _manifestSteps[stepIndex];
        uint256 requestId;

        if (step.kind == 0) {
            requestId = WorldAgentLib.requestAgentDecision(
                _agent,
                _state,
                config,
                triggerId,
                _join(step.prompt, previousResult),
                step.system,
                new string[](0),
                0,
                this.handleAgentResponse.selector
            );
            _pendingWorkflows[requestId] = PendingWorkflow(true, triggerId, stepIndex + 1, endStep);
            emit WorkflowStepRequested(triggerId, stepIndex, step.kind, requestId);
            return;
        }

        if (step.kind == 1) {
            requestId = WorldDataOracleLib.requestJsonOracle(
                _oracle,
                _state,
                config,
                triggerId,
                step.url,
                step.selector,
                0,
                this.handleJsonOracleResponse.selector
            );
            _pendingWorkflows[requestId] = PendingWorkflow(true, triggerId, stepIndex + 1, endStep);
            emit WorkflowStepRequested(triggerId, stepIndex, step.kind, requestId);
            return;
        }

        if (step.kind == 2) {
            requestId = WorldDataOracleLib.requestWebParse(
                _oracle,
                _state,
                config,
                triggerId,
                step.payload,
                0,
                this.handleJsonOracleResponse.selector
            );
            _pendingWorkflows[requestId] = PendingWorkflow(true, triggerId, stepIndex + 1, endStep);
            emit WorkflowStepRequested(triggerId, stepIndex, step.kind, requestId);
            return;
        }

        if (step.kind == 3) {
            WorldChronicleLib.recordFromAgent(_state, _join(step.prompt, previousResult), 0);
            _runManifestStep(triggerId, stepIndex + 1, endStep, previousResult);
            return;
        }

        if (step.kind == 4) {
            WorldStateLib.applyClimateResult(_state, step.zoneId, previousResult);
            _runManifestStep(triggerId, stepIndex + 1, endStep, previousResult);
            return;
        }

        if (step.kind == 5) {
            WorldStateLib.applyConflictOutcome(_state, step.zoneId, previousResult);
            _runManifestStep(triggerId, stepIndex + 1, endStep, previousResult);
            return;
        }

        if (step.kind == 6) {
            WorldStateLib.updateFactionMorale(_state, step.factionId, 0, previousResult);
            _runManifestStep(triggerId, stepIndex + 1, endStep, previousResult);
            return;
        }

        if (step.kind == 8) {
            WorldStateLib.pushEvent(_state, step.prompt, previousResult, 0);
            _runManifestStep(triggerId, stepIndex + 1, endStep, previousResult);
            return;
        }

        if (step.kind == 9) {
            WorldStateLib.applyAgentResult(_state, step.zoneId, previousResult, step.prompt);
            _runManifestStep(triggerId, stepIndex + 1, endStep, previousResult);
            return;
        }

        if (step.kind == 10) {
            WorldStateLib.updateFactionMorale(_state, step.factionId, 0, previousResult);
            _runManifestStep(triggerId, stepIndex + 1, endStep, previousResult);
            return;
        }

        revert UnsupportedWorkflowStep(step.kind);
    }

    function _continueManifestWorkflow(
        uint256 requestId,
        ResponseStatus status,
        string memory result
    ) internal {
        PendingWorkflow memory pending = _pendingWorkflows[requestId];
        if (!pending.exists) return;
        delete _pendingWorkflows[requestId];
        if (status != ResponseStatus.Success) {
            emit WorkflowCompleted(pending.triggerId, "agent_request_failed");
            _dispatchDecisionContinuation(pending.triggerId, "agent_request_failed");
            return;
        }
        _runManifestStep(pending.triggerId, pending.nextStep, pending.endStep, result);
    }

    function _dispatchDecisionContinuation(bytes32 triggerId, string memory result) internal {
        ManifestContinuation[] storage continuations = _manifestContinuations[triggerId];
        if (continuations.length == 0 || _continuationDepth >= MAX_CONTINUATION_DEPTH) return;

        for (uint256 i = 0; i < continuations.length; i++) {
            ManifestContinuation storage c = continuations[i];
            if (bytes(c.matchValue).length == 0 || !_startsWith(result, c.matchValue)) {
                continue;
            }

            emit DecisionContinuationMatched(triggerId, c.nextTriggerId, c.matchValue, c.terminal);
            if (c.terminal) {
                if (keccak256(bytes(c.matchValue)) == keccak256(bytes('{"decision":"wait_next_day"'))) {
                    lifecycleStatus = 4;
                    emit LifecycleStatusChanged(lifecycleStatus, "decision_wait");
                } else {
                    lifecycleStatus = 5;
                    emit LifecycleStatusChanged(lifecycleStatus, "decision_terminal");
                }
                return;
            }

            _continuationDepth += 1;
            _fireManifestTrigger(c.nextTriggerId, result);
            _continuationDepth -= 1;
            return;
        }
    }

    function _startsWith(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0) return true;
        if (h.length < n.length) return false;
        for (uint256 i = 0; i < n.length; i++) {
            if (h[i] != n[i]) return false;
        }
        return true;
    }

    function _firstSuccessfulString(Response[] memory responses) internal pure returns (string memory) {
        for (uint256 i = 0; i < responses.length; i++) {
            if (responses[i].status == ResponseStatus.Success && responses[i].result.length > 0) {
                return abi.decode(responses[i].result, (string));
            }
        }
        if (responses.length > 0 && responses[0].result.length > 0) {
            return abi.decode(responses[0].result, (string));
        }
        return "";
    }

    function _join(string memory prompt, string memory previousResult) internal pure returns (string memory) {
        if (bytes(previousResult).length == 0) return prompt;
        return string.concat(prompt, "\n\nPrevious step result:\n", previousResult);
    }

    function upgradeToAndCall(address newImplementation, bytes calldata data) external payable onlyOwner {
        if (newImplementation.code.length == 0) revert InvalidManifest();
        assembly {
            sstore(ERC1967_IMPLEMENTATION_SLOT, newImplementation)
        }
        emit Upgraded(newImplementation);
        if (data.length > 0) {
            (bool ok, bytes memory result) = newImplementation.delegatecall(data);
            if (!ok) {
                assembly {
                    revert(add(result, 0x20), mload(result))
                }
            }
        }
    }
}
