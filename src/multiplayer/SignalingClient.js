/**
 * SignalingClient
 * 
 * Supports both:
 * 1. Serverless P2P direct data channel & media via PeerJS free cloud (zero-backend, works on GitHub Pages)
 * 2. Socket.IO signaling server (when deployed to Node.js backend)
 */

const ICE_SERVERS = [
	{ urls: 'stun:stun.l.google.com:19302' },
	{ urls: 'stun:stun1.l.google.com:19302' },
	{ urls: 'stun:stun2.l.google.com:19302' },
	{ urls: 'stun:stun.relay.metered.ca:80' },
	{
		urls: 'turn:standard.relay.metered.ca:80',
		username: 'e89c62391ce5fa219e5e3ca9',
		credential: 'VbFmP/ZkW+nB0466',
	},
	{
		urls: 'turn:standard.relay.metered.ca:443',
		username: 'e89c62391ce5fa219e5e3ca9',
		credential: 'VbFmP/ZkW+nB0466',
	},
	{
		urls: 'turn:standard.relay.metered.ca:443?transport=tcp',
		username: 'e89c62391ce5fa219e5e3ca9',
		credential: 'VbFmP/ZkW+nB0466',
	},
];

export class SignalingClient {
	constructor() {
		this.mode = 'peerjs'; // 'peerjs' or 'socket'
		this.socket = null;
		this.peer = null;
		this.activeConn = null;
		this.targetPeerId = null;
		this.currentRoom = null;
		this.visibilityBound = false;
		this.callbacks = {
			connect: [],
			disconnect: [],
			peerJoined: [],
			peerLeft: [],
			signal: [],
			error: [],
			activeConnReady: [],
		};

		// Auto-reconnect if mobile browser throttles the tab in background
		document.addEventListener('visibilitychange', () => {
			if (
				document.visibilityState === 'visible' &&
				this.peer &&
				this.peer.disconnected &&
				!this.peer.destroyed
			) {
				console.log('[PeerJS] Tab restored, reconnecting to broker...');
				try {
					this.peer.reconnect();
				} catch (err) {
					console.warn('[PeerJS] Reconnect failed:', err);
				}
			}
		});
	}

	connect() {
		const customServer =
			window.SIGNALING_SERVER_URL || localStorage.getItem('sf2_signaling_url');

		// If a custom backend is explicitly provided, use Socket.IO
		if (customServer && typeof window.io === 'function') {
			try {
				this.socket = window.io(customServer, {
					reconnectionAttempts: 2,
					timeout: 3000,
				});

				this.socket.on('connect', () => {
					this.mode = 'socket';
					console.log('[Signaling] Connected to custom Socket.IO backend');
					this.emitEvent('connect', { mode: 'socket' });
				});

				this.socket.on('disconnect', (reason) => {
					this.emitEvent('disconnect', reason);
				});

				this.socket.on('connect_error', (error) => {
					console.warn('[Signaling] Custom server unavailable, falling back to serverless PeerJS:', error.message);
					this.switchToPeerJS();
				});

				this.socket.on('room:peer-joined', (data) => {
					this.emitEvent('peerJoined', data);
				});

				this.socket.on('room:peer-left', () => {
					this.emitEvent('peerLeft');
				});

				this.socket.on('rtc:signal', (signal) => {
					this.emitEvent('signal', signal);
				});

				return;
			} catch (err) {
				console.warn('[Signaling] Socket init error, falling back to PeerJS:', err);
			}
		}

		// Universal Serverless P2P (PeerJS free cloud)
		this.switchToPeerJS();
	}

	switchToPeerJS() {
		this.mode = 'peerjs';
		if (this.socket) {
			try {
				this.socket.disconnect();
			} catch {}
			this.socket = null;
		}

		console.log('[Signaling] Serverless P2P mode active (PeerJS cloud)');
		setTimeout(() => {
			this.emitEvent('connect', { mode: 'peerjs' });
		}, 100);
	}

	on(event, callback) {
		if (this.callbacks[event]) {
			this.callbacks[event].push(callback);
		}
	}

	off(event, callback) {
		if (this.callbacks[event]) {
			this.callbacks[event] = this.callbacks[event].filter((cb) => cb !== callback);
		}
	}

	emitEvent(event, data) {
		if (this.callbacks[event]) {
			for (const callback of this.callbacks[event]) {
				try {
					callback(data);
				} catch (err) {
					console.error(`Error in SignalingClient ${event} callback:`, err);
				}
			}
		}
	}

	createRoom() {
		if (this.mode === 'socket' && this.socket?.connected) {
			return new Promise((resolve, reject) => {
				this.socket.emit('room:create', (response) => {
					if (response?.error) {
						reject(new Error(response.error));
					} else {
						resolve(response);
					}
				});
			});
		}

		// Serverless PeerJS Room Creation
		return new Promise((resolve, reject) => {
			if (typeof window.Peer !== 'function') {
				return reject(new Error('PeerJS library not loaded. Check internet connection.'));
			}

			// Keep screen awake while waiting for opponent
			if ('wakeLock' in navigator) {
				navigator.wakeLock.request('screen').catch(() => {});
			}

			this.cleanupPeer();

			const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
			const generateCode = () => {
				let s = '';
				for (let i = 0; i < 6; i++) {
					s += chars.charAt(Math.floor(Math.random() * chars.length));
				}
				return s;
			};

			const code = generateCode();
			const peerId = `sf2-room-${code}`;
			this.currentRoom = code;

			this.peer = new window.Peer(peerId, {
				debug: 0,
				config: {
					iceServers: ICE_SERVERS,
				},
			});

			let resolved = false;

			this.peer.on('open', () => {
				resolved = true;
				console.log(`[PeerJS] Host registered with room ID: ${peerId}`);
				const sessionToken = 'st_' + Math.random().toString(36).substring(2, 10);
				resolve({
					code,
					playerId: 'player-1',
					playerNumber: 1,
					sessionToken,
				});
			});

			this.peer.on('connection', (conn) => {
				this.activeConn = conn;
				this.targetPeerId = conn.peer;

				const onConnReady = () => {
					console.log(`[PeerJS] Opponent joined room ${code} (peer: ${conn.peer})`);
					this.emitEvent('activeConnReady', conn);
					this.emitEvent('peerJoined', {
						playerId: 'player-2',
						playerNumber: 2,
					});
				};

				if (conn.open) {
					onConnReady();
				} else {
					conn.on('open', onConnReady);
				}

				conn.on('close', () => {
					console.log('[PeerJS] Opponent signaling channel closed');
					this.emitEvent('peerLeft');
				});
			});

			this.peer.on('error', (err) => {
				console.warn('[PeerJS Room Error]', err);
				if (!resolved) {
					resolved = true;
					reject(new Error(err.type === 'unavailable-id' ? 'Room collision, please try again.' : err.message));
				} else {
					this.emitEvent('error', err);
				}
			});
		});
	}

	joinRoom(rawCode) {
		if (this.mode === 'socket' && this.socket?.connected) {
			return new Promise((resolve, reject) => {
				this.socket.emit('room:join', { code: rawCode }, (response) => {
					if (response?.error) {
						reject(new Error(response.error));
					} else {
						resolve(response);
					}
				});
			});
		}

		// Serverless PeerJS Room Join
		return new Promise((resolve, reject) => {
			if (typeof window.Peer !== 'function') {
				return reject(new Error('PeerJS library not loaded. Check internet connection.'));
			}

			const code = (rawCode || '').trim().toUpperCase();
			if (!code || code.length < 3) {
				return reject(new Error('Please enter a valid room code.'));
			}

			// Keep screen awake during gameplay
			if ('wakeLock' in navigator) {
				navigator.wakeLock.request('screen').catch(() => {});
			}

			this.cleanupPeer();
			this.currentRoom = code;

			const myPeerId = `sf2-cli-${code}-${Math.random().toString(36).substring(2, 7)}`;
			const targetHostPeerId = `sf2-room-${code}`;
			this.targetPeerId = targetHostPeerId;

			this.peer = new window.Peer(myPeerId, {
				debug: 0,
				config: {
					iceServers: ICE_SERVERS,
				},
			});

			let settled = false;

			this.peer.on('open', () => {
				console.log(`[PeerJS] Connecting to host: ${targetHostPeerId}`);
				// reliable: true is essential for standard cross-platform WebRTC DataChannel on mobile
				const conn = this.peer.connect(targetHostPeerId, { reliable: true });
				this.activeConn = conn;

				const timeoutId = setTimeout(() => {
					if (!settled) {
						settled = true;
						try { conn.close(); } catch {}
						reject(new Error(`Room "${code}" not found. Ensure host has room open and is online.`));
					}
				}, 14000);

				conn.on('open', () => {
					if (!settled) {
						settled = true;
						clearTimeout(timeoutId);
						console.log(`[PeerJS] Successfully connected to host in room ${code}`);
						this.emitEvent('activeConnReady', conn);
						const sessionToken = 'st_' + Math.random().toString(36).substring(2, 10);
						resolve({
							code,
							playerId: 'player-2',
							playerNumber: 2,
							sessionToken,
						});
					}
				});

				conn.on('close', () => {
					this.emitEvent('peerLeft');
				});

				conn.on('error', (err) => {
					if (!settled) {
						settled = true;
						clearTimeout(timeoutId);
						reject(new Error(`Failed to connect to room "${code}": ${err.message}`));
					}
				});
			});

			this.peer.on('error', (err) => {
				console.warn('[PeerJS Join Error]', err);
				if (!settled) {
					settled = true;
					reject(new Error(err.type === 'peer-unavailable' ? `Room "${code}" not found. Verify the code.` : err.message));
				} else {
					this.emitEvent('error', err);
				}
			});
		});
	}

	sendSignal(type, payload) {
		if (this.mode === 'socket' && this.socket?.connected) {
			this.socket.emit('rtc:signal', { type, payload });
			return;
		}

		if (this.activeConn && this.activeConn.open) {
			this.activeConn.send({ type, payload });
		}
	}

	leaveRoom() {
		if (this.mode === 'socket' && this.socket?.connected) {
			this.socket.emit('room:leave');
		}

		if (this.activeConn) {
			try {
				this.activeConn.close();
			} catch {}
			this.activeConn = null;
		}

		this.cleanupPeer();
		this.currentRoom = null;
		this.targetPeerId = null;
	}

	cleanupPeer() {
		if (this.peer) {
			try {
				this.peer.destroy();
			} catch {}
			this.peer = null;
		}
	}

	disconnect() {
		this.leaveRoom();
		if (this.socket) {
			try {
				this.socket.disconnect();
			} catch {}
			this.socket = null;
		}
	}
}
