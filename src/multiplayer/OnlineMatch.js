import {
	getLocalInputState,
	setOnlineMode,
	setRemoteInput,
	clearAllInputs,
} from '../engine/InputHandler.js';
import { BattleScene } from '../scenes/BattleScene.js';
import { gameState } from '../states/gameState.js';
import { FighterState } from '../constants/fighter.js';
import { GameSync } from './GameSync.js';

export class OnlineMatch {
	constructor({
		peerConnection,
		roomId,
		playerId,
		playerNumber,
		sessionToken,
		onStatusChange,
		onPingUpdate,
		onSecurityAlert,
	}) {
		this.peer = peerConnection;
		this.roomId = roomId;
		this.playerId = playerId || (playerNumber === 1 ? 'player-1' : 'player-2');
		this.playerNumber = playerNumber; // 1 or 2
		this.sessionToken = sessionToken;

		// Strict identity mapping
		this.isHost = this.playerNumber === 1;
		this.localIndex = this.isHost ? 0 : 1; // 0 for Ryu (P1), 1 for Ken (P2)
		this.remoteIndex = 1 - this.localIndex;
		this.expectedRemotePlayerId = this.isHost ? 'player-2' : 'player-1';

		this.onStatusChange = onStatusChange;
		this.onPingUpdate = onPingUpdate;
		this.onSecurityAlert = onSecurityAlert;

		this.active = false;
		this.inputLoopId = null;
		this.syncIntervalId = null;

		// Initialize input synchronization with strict security verification
		this.gameSync = new GameSync(this.peer, {
			roomId: this.roomId,
			localPlayerId: this.playerId,
			expectedRemotePlayerId: this.expectedRemotePlayerId,
			sessionToken: this.sessionToken,
			onRemoteInput: (input) => {
				this.applyRemoteInput(input);
			},
			onStateSync: (data) => {
				this.reconcileState(data);
			},
			onMatchEvent: (event, data) => {
				this.handleMatchEvent(event, data);
			},
			onPingUpdate: (ping) => {
				this.onPingUpdate?.(ping);
			},
			onSecurityViolation: (alert) => {
				this.onSecurityAlert?.(alert);
			},
		});

		// Attach data receiver to peer connection
		this.peer.onData = (message) => {
			this.gameSync.receive(message);
		};

		this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
		document.addEventListener('visibilitychange', this.handleVisibilityChange);
		window.addEventListener('blur', this.handleVisibilityChange);
	}

	start() {
		this.active = true;

		// STRICT INPUT ISOLATION:
		// Enable online mode where local controls can ONLY influence this.localIndex
		setOnlineMode(true, this.localIndex);

		// Start local input transmission loop at ~60fps
		const sendLoop = () => {
			if (!this.active) return;
			const input = getLocalInputState(this.localIndex);
			this.gameSync.sendInput(input);
			this.inputLoopId = requestAnimationFrame(sendLoop);
		};
		this.inputLoopId = requestAnimationFrame(sendLoop);

		// Host periodically sends authoritative state sync (10 times per second)
		if (this.isHost) {
			this.syncIntervalId = setInterval(() => {
				this.sendHostStateSync();
			}, 100);
		}

		// Notify game to start the battle
		this.startBattle();

		if (this.isHost) {
			this.gameSync.sendMatchEvent('start-battle');
		}

		this.onStatusChange?.(`Match live! You are ${this.playerId.toUpperCase()} (${this.isHost ? 'Ryu' : 'Ken'})`);
	}

	applyRemoteInput(input) {
		// Strict ownership check: input is applied ONLY to remoteIndex
		setRemoteInput(this.remoteIndex, input);

		// Handle mobile special attack shortcut if remote player triggered it
		if (input.special && window.gameInstance?.scene instanceof BattleScene) {
			const remoteFighter = window.gameInstance.scene.fighters?.[this.remoteIndex];
			if (remoteFighter && remoteFighter.currentState === FighterState.IDLE) {
				remoteFighter.changeState(FighterState.SPECIAL_1_LIGHT, window.gameInstance.frameTime);
			}
		}
	}

	handleVisibilityChange() {
		if (document.hidden || !document.hasFocus()) {
			clearAllInputs();
			if (this.active) {
				// Send empty input to prevent opponent from seeing continuous walking
				this.gameSync.sendInput({
					left: false,
					right: false,
					up: false,
					down: false,
					lightPunch: false,
					mediumPunch: false,
					heavyPunch: false,
					lightKick: false,
					mediumKick: false,
					heavyKick: false,
					special: false,
					block: false,
				});
			}
		}
	}

	startBattle() {
		if (window.gameInstance) {
			window.gameInstance.changeScene(BattleScene);
		}
	}

	sendHostStateSync() {
		if (!this.active || !this.isHost || !window.gameInstance) return;

		const currentScene = window.gameInstance.scene;
		if (!(currentScene instanceof BattleScene)) return;

		const f0 = currentScene.fighters?.[0];
		const f1 = currentScene.fighters?.[1];

		if (!f0 || !f1) return;

		const syncData = {
			f0: {
				x: Math.round(f0.position.x),
				y: Math.round(f0.position.y),
				state: f0.currentState,
				hp: gameState.fighters[0].hitPoints,
				score: gameState.fighters[0].score,
			},
			f1: {
				x: Math.round(f1.position.x),
				y: Math.round(f1.position.y),
				state: f1.currentState,
				hp: gameState.fighters[1].hitPoints,
				score: gameState.fighters[1].score,
			},
		};

		this.gameSync.sendStateSync(syncData);
	}

	reconcileState(data) {
		// Only guest reconciles from host state
		if (this.isHost || !this.active || !window.gameInstance) return;

		const currentScene = window.gameInstance.scene;
		if (!(currentScene instanceof BattleScene)) return;

		const f0 = currentScene.fighters?.[0];
		const f1 = currentScene.fighters?.[1];

		if (!f0 || !f1 || !data.f0 || !data.f1) return;

		// Interpolate / snap opponent (P1 Ryu) position if divergence exceeds threshold
		if (Math.abs(f0.position.x - data.f0.x) > 6) {
			f0.position.x += (data.f0.x - f0.position.x) * 0.4;
		}
		if (Math.abs(f0.position.y - data.f0.y) > 6) {
			f0.position.y = data.f0.y;
		}

		// Reconcile HP and score accurately from authoritative host
		if (typeof data.f0.hp === 'number') {
			gameState.fighters[0].hitPoints = data.f0.hp;
		}
		if (typeof data.f1.hp === 'number') {
			gameState.fighters[1].hitPoints = data.f1.hp;
		}
		if (typeof data.f0.score === 'number') {
			gameState.fighters[0].score = data.f0.score;
		}
		if (typeof data.f1.score === 'number') {
			gameState.fighters[1].score = data.f1.score;
		}
	}

	handleMatchEvent(event, data) {
		if (event === 'start-battle' || event === 'rematch') {
			this.startBattle();
		}
	}

	requestRematch() {
		this.startBattle();
		this.gameSync.sendMatchEvent('rematch');
	}

	stop() {
		this.active = false;
		if (this.inputLoopId) {
			cancelAnimationFrame(this.inputLoopId);
			this.inputLoopId = null;
		}
		if (this.syncIntervalId) {
			clearInterval(this.syncIntervalId);
			this.syncIntervalId = null;
		}
		if (this.gameSync) {
			this.gameSync.destroy();
		}
		document.removeEventListener('visibilitychange', this.handleVisibilityChange);
		window.removeEventListener('blur', this.handleVisibilityChange);
		clearAllInputs();
		setOnlineMode(false);
	}
}
