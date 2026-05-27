// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {WorldTypes} from "./WorldTypes.sol";

library WorldStateLib {
    struct Storage {
        mapping(bytes32 => WorldTypes.Zone) zones;
        mapping(string => WorldTypes.FactionMorale) factionMorale;
        WorldTypes.WorldEvent[] eventHistory;
        mapping(bytes32 => uint256) triggerCooldowns;
    }

    event ZoneUpdated(bytes32 indexed zoneId, string newFaction, uint256 newDanger);
    event FactionMoraleUpdated(string indexed factionId, int256 moraleDelta, string narrative);

    error CooldownActive();

    function setZone(
        Storage storage self,
        bytes32 zoneId,
        string calldata name,
        uint256 dangerLevel,
        string calldata faction
    ) internal {
        WorldTypes.Zone storage z = self.zones[zoneId];
        z.name = name;
        z.dangerLevel = dangerLevel;
        z.controllingFaction = faction;
        if (bytes(z.climateState).length == 0) {
            z.climateState = "clear";
        }
    }

    function applyClimateResult(
        Storage storage self,
        bytes32 zoneId,
        string calldata climateState
    ) internal {
        WorldTypes.Zone storage z = self.zones[zoneId];
        require(bytes(z.name).length > 0, "Unknown zone");
        z.climateState = climateState;
        self.eventHistory.push(
            WorldTypes.WorldEvent(
                block.timestamp,
                "climate_update",
                climateState,
                0
            )
        );
        emit ZoneUpdated(zoneId, z.controllingFaction, z.dangerLevel);
    }

    function applyConflictOutcome(
        Storage storage self,
        bytes32 zoneId,
        string calldata outcome
    ) internal {
        WorldTypes.Zone storage z = self.zones[zoneId];
        require(bytes(z.name).length > 0, "Unknown zone");

        if (keccak256(bytes(outcome)) == keccak256(bytes("faction_a_wins"))) {
            z.dangerLevel = z.dangerLevel > 0 ? z.dangerLevel - 1 : 0;
        } else if (keccak256(bytes(outcome)) == keccak256(bytes("faction_b_wins"))) {
            z.dangerLevel = z.dangerLevel < 10 ? z.dangerLevel + 1 : 10;
        } else if (keccak256(bytes(outcome)) == keccak256(bytes("zone_destroyed"))) {
            z.dangerLevel = 10;
            z.controllingFaction = "ruins";
        } else if (keccak256(bytes(outcome)) == keccak256(bytes("ceasefire"))) {
            if (z.dangerLevel > 0) z.dangerLevel -= 1;
        }

        self.eventHistory.push(
            WorldTypes.WorldEvent(block.timestamp, "conflict_outcome", outcome, 0)
        );
        emit ZoneUpdated(zoneId, z.controllingFaction, z.dangerLevel);
    }

    function updateFactionMorale(
        Storage storage self,
        string calldata factionId,
        int256 moraleDelta,
        string calldata narrative
    ) internal {
        self.factionMorale[factionId] = WorldTypes.FactionMorale({
            moraleDelta: moraleDelta,
            narrative: narrative,
            updatedAt: block.timestamp
        });
        self.eventHistory.push(
            WorldTypes.WorldEvent(
                block.timestamp,
                "faction_morale",
                narrative,
                0
            )
        );
        emit FactionMoraleUpdated(factionId, moraleDelta, narrative);
    }

    function applyAgentResult(
        Storage storage self,
        bytes32 zoneId,
        string calldata outcome,
        string calldata eventType
    ) internal {
        self.eventHistory.push(
            WorldTypes.WorldEvent(block.timestamp, eventType, outcome, 0)
        );
        if (bytes(self.zones[zoneId].name).length > 0) {
            emit ZoneUpdated(zoneId, self.zones[zoneId].controllingFaction, self.zones[zoneId].dangerLevel);
        }
    }

    function checkCooldown(
        Storage storage self,
        bytes32 triggerId,
        uint256 cooldownSeconds
    ) internal {
        if (block.timestamp < self.triggerCooldowns[triggerId] + cooldownSeconds) {
            revert CooldownActive();
        }
        self.triggerCooldowns[triggerId] = block.timestamp;
    }

    function pushEvent(
        Storage storage self,
        string memory eventType,
        string memory description,
        uint256 requestId
    ) internal returns (uint256 index) {
        index = self.eventHistory.length;
        self.eventHistory.push(
            WorldTypes.WorldEvent(block.timestamp, eventType, description, requestId)
        );
    }
}
