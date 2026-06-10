// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ISomniaReactivityPrecompile} from "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";

/**
 * @title ReactivityLib
 * @dev On-chain event subscriptions via Somnia Reactivity precompile (0x0100).
 */
library ReactivityLib {
    ISomniaReactivityPrecompile private constant PRECOMPILE =
        ISomniaReactivityPrecompile(SomniaExtensions.SOMNIA_REACTIVITY_PRECOMPILE_ADDRESS);

    function subscribeToEmitter(
        address handler,
        address emitter,
        bytes32 eventSig,
        uint64 gasLimit
    ) internal returns (uint256 subscriptionId) {
        bytes32[4] memory topics = [eventSig, bytes32(0), bytes32(0), bytes32(0)];
        subscriptionId = subscribeWithTopics(handler, emitter, topics, gasLimit);
    }

    function subscribeWithTopics(
        address handler,
        address emitter,
        bytes32[4] memory eventTopics,
        uint64 gasLimit
    ) internal returns (uint256 subscriptionId) {
        ISomniaReactivityPrecompile.SubscriptionData memory subData =
            ISomniaReactivityPrecompile.SubscriptionData({
                eventTopics: eventTopics,
                origin: address(0),
                caller: address(0),
                emitter: emitter,
                handlerContractAddress: handler,
                handlerFunctionSelector: bytes4(
                    keccak256("onEvent(address,bytes32[],bytes)")
                ),
                priorityFeePerGas: 2_000_000_000,
                maxFeePerGas: 10_000_000_000,
                gasLimit: gasLimit,
                isGuaranteed: true,
                isCoalesced: false
            });

        subscriptionId = PRECOMPILE.subscribe(subData);
    }

    function unsubscribe(uint256 subscriptionId) internal {
        PRECOMPILE.unsubscribe(subscriptionId);
    }
}
