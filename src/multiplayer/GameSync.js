export class GameSync {
	constructor(peer, {
		roomId,
		localPlayerId,
		expectedRemotePlayerId,
		sessionToken,
		onRemoteInput,
		onStateSync,
		onMatchEvent,
		onPingUpdate,
		onSecurityViolation,
	} = {}) {
		this.peer = peer;
		this.roomId = roomId;
		this.localPlayerId = localPlayerId; // 'player-1' or 'player-2'
		this.expectedRemotePlayerId = expectedRemotePlayerId; // 'player-2' or 'player-1'
		this.sessionToken = sessionToken;

		this.onRemoteInput = onRemoteInput;
		this.onStateSync = onStateSync;
		this.onMatchEvent = onMatchEvent;
		this.onPingUpdate = onPingUpdate;
		this.onSecurityViolation = onSecurityViolation;

		this.sequence = 0;
		this.syncSequence = 0;
		this.lastRemoteSequence = -1;
		this.lastRemoteSyncSequence = -1;

		// Ping calculation
		this.pingInterval = null;
		this.lastPingSentTime = 0;
		this.currentPing = 0;

		this.startPingMonitor();
	}

	startPingMonitor() {
		this.pingInterval = setInterval(() => {
			if (this.peer?.channel?.readyState === 'open') {
				this.lastPingSentTime = performance.now();
				this.peer.send({
					type: 'ping',
					roomId: this.roomId,
					playerId: this.localPlayerId,
					clientTime: this.lastPingSentTime,
				});
			}
		}, 2000);
	}

	sendInput(input) {
		if (!this.peer || this.peer.closed) return false;

		const message = {
			type: 'input',
			roomId: this.roomId,
			playerId: this.localPlayerId,
			sequence: ++this.sequence,
			timestamp: performance.now(),
			input: {
				left: !!input.left,
				right: !!input.right,
				up: !!input.up,
				down: !!input.down,
				lightPunch: !!input.lightPunch,
				mediumPunch: !!input.mediumPunch,
				heavyPunch: !!input.heavyPunch,
				lightKick: !!input.lightKick,
				mediumKick: !!input.mediumKick,
				heavyKick: !!input.heavyKick,
				special: !!input.special,
				block: !!input.block,
			},
		};

		return this.peer.send(message);
	}

	sendStateSync(syncData) {
		if (!this.peer || this.peer.closed) return false;

		// Only Player 1 (Host) is authorized to broadcast state synchronization
		if (this.localPlayerId !== 'player-1') {
			console.warn('[Security] Guest attempted to send authoritative state sync. Blocked.');
			return false;
		}

		return this.peer.send({
			type: 'state-sync',
			roomId: this.roomId,
			playerId: this.localPlayerId,
			sequence: ++this.syncSequence,
			timestamp: performance.now(),
			data: syncData,
		});
	}

	sendMatchEvent(event, data = {}) {
		if (!this.peer || this.peer.closed) return false;

		return this.peer.send({
			type: 'match-event',
			roomId: this.roomId,
			playerId: this.localPlayerId,
			event,
			data,
		});
	}

	receive(message) {
		if (!message || typeof message !== 'object') return;

		// STRICT PLAYER OWNERSHIP & SESSION VALIDATION
		// Verify Room ID
		if (this.roomId && message.roomId && message.roomId !== this.roomId) {
			const err = `[Security Error] Room mismatch: received '${message.roomId}', current is '${this.roomId}'`;
			console.warn(err);
			this.onSecurityViolation?.(err);
			return;
		}

		// Verify that input is targeting/from the established peer
		if (message.playerId && message.playerId !== this.expectedRemotePlayerId) {
			const err = `[Security Alert] Rejected unauthorized packet: claimed '${message.playerId}', but connection is strictly bound to '${this.expectedRemotePlayerId}'!`;
			console.error(err);
			this.onSecurityViolation?.(err);
			return;
		}

		switch (message.type) {
			case 'input': {
				// Anti-replay and sequencing validation
				if (!Number.isSafeInteger(message.sequence)) {
					console.warn('[Security] Dropping input packet with invalid sequence integer');
					return;
				}
				if (message.sequence <= this.lastRemoteSequence) {
					// Stale or duplicate packet
					return;
				}
				if (!message.input || typeof message.input !== 'object') {
					console.warn('[Security] Dropping malformed input payload');
					return;
				}

				this.lastRemoteSequence = message.sequence;

				// Strictly sanitize booleans
				this.onRemoteInput?.({
					left: message.input.left === true,
					right: message.input.right === true,
					up: message.input.up === true,
					down: message.input.down === true,
					lightPunch: message.input.lightPunch === true,
					mediumPunch: message.input.mediumPunch === true,
					heavyPunch: message.input.heavyPunch === true,
					lightKick: message.input.lightKick === true,
					mediumKick: message.input.mediumKick === true,
					heavyKick: message.input.heavyKick === true,
					special: message.input.special === true,
					block: message.input.block === true,
				});
				break;
			}

			case 'state-sync': {
				// Authoritative sync is accepted ONLY from Player 1 (Host)
				if (message.playerId !== 'player-1') {
					console.warn(`[Security] Dropping unauthorized state-sync from non-host '${message.playerId}'`);
					return;
				}
				if (!Number.isSafeInteger(message.sequence) || message.sequence <= this.lastRemoteSyncSequence) {
					return;
				}
				this.lastRemoteSyncSequence = message.sequence;

				if (message.data && typeof message.data === 'object') {
					this.onStateSync?.(message.data);
				}
				break;
			}

			case 'match-event': {
				if (message.event) {
					this.onMatchEvent?.(message.event, message.data);
				}
				break;
			}

			case 'ping': {
				this.peer.send({
					type: 'pong',
					roomId: this.roomId,
					playerId: this.localPlayerId,
					clientTime: message.clientTime,
				});
				break;
			}

			case 'pong': {
				if (message.clientTime) {
					const rtt = Math.round(performance.now() - message.clientTime);
					this.currentPing = rtt;
					this.onPingUpdate?.(rtt);
				}
				break;
			}
		}
	}

	destroy() {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}
}
