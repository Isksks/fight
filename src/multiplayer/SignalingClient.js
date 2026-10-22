/**
 * SignalingClient
 * 
 * Supports both:
 * 1. Serverless P2P signaling via PeerJS free cloud (zero-backend, works on GitHub Pages)
 * 2. Socket.IO signaling server (when deployed to Node.js backend or localhost)
 */
export class SignalingClient {
	constructor() {
		this.mode = 'peerjs'; // 'peerjs' or 'socket'
		this.socket = null;
		this.peer = null;
		this.activeConn = null;
		this.currentRoom = null;
		this.callbacks = {
			connect: [],
			disconnect: [],
			peerJoined: [],
			peerLeft: [],
			signal: [],
			error: [],
		};
	}

	connect() {
		const isLocalhost =
			window.location.hostname === 'localhost' ||
			window.location.hostname === '127.0.0.1';
		const customServer =
			window.SIGNALING_SERVER_URL || localStorage.getItem('sf2_signaling_url');

		// If a custom backend or localhost is present and Socket.IO is loaded, attempt socket connection
		if ((customServer || isLocalhost) && typeof window.io === 'function') {
			try {
				this.socket = window.io(customServer || undefined, {
					reconnectionAttempts: 2,
					timeout: 3000,
				});

				this.socket.on('connect', () => {
					this.mode = 'socket';
					console.log('[Signaling] Connected to Socket.IO backend');
					this.emitEvent('connect', { mode: 'socket' });
				});

				this.socket.on('disconnect', (reason) => {
					this.emitEvent('disconnect', reason);
				});

				this.socket.on('connect_error', (error) => {
					console.warn('[Signaling] Socket.IO server unavailable, switching to serverless PeerJS:', error.message);
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

		// Default for GitHub Pages and static hosts: Serverless PeerJS
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
		// Emit connect so the lobby status updates to ready
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
					iceServers: [
						{ urls: 'stun:stun.l.google.com:19302' },
						{ urls: 'stun:stun1.l.google.com:19302' },
						{ urls: 'stun:stun2.l.google.com:19302' },
					],
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
				conn.on('open', () => {
					console.log(`[PeerJS] Opponent joined room ${code}`);
					this.emitEvent('peerJoined', {
						playerId: 'player-2',
						playerNumber: 2,
					});
				});

				conn.on('data', (data) => {
					if (data && data.type) {
						this.emitEvent('signal', data);
					}
				});

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

			this.cleanupPeer();
			this.currentRoom = code;

			const myPeerId = `sf2-cli-${code}-${Math.random().toString(36).substring(2, 7)}`;
			const targetHostPeerId = `sf2-room-${code}`;

			this.peer = new window.Peer(myPeerId, {
				debug: 0,
				config: {
					iceServers: [
						{ urls: 'stun:stun.l.google.com:19302' },
						{ urls: 'stun:stun1.l.google.com:19302' },
						{ urls: 'stun:stun2.l.google.com:19302' },
					],
				},
			});

			let settled = false;

			this.peer.on('open', () => {
				console.log(`[PeerJS] Connecting to host: ${targetHostPeerId}`);
				const conn = this.peer.connect(targetHostPeerId, { reliable: true });
				this.activeConn = conn;

				const timeoutId = setTimeout(() => {
					if (!settled) {
						settled = true;
						try { conn.close(); } catch {}
						reject(new Error(`Room "${code}" not found or host is offline.`));
					}
				}, 12000);

				conn.on('open', () => {
					if (!settled) {
						settled = true;
						clearTimeout(timeoutId);
						console.log(`[PeerJS] Successfully connected to host in room ${code}`);
						const sessionToken = 'st_' + Math.random().toString(36).substring(2, 10);
						resolve({
							code,
							playerId: 'player-2',
							playerNumber: 2,
							sessionToken,
						});
					}
				});

				conn.on('data', (data) => {
					if (data && data.type) {
						this.emitEvent('signal', data);
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
