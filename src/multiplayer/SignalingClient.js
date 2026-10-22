export class SignalingClient {
	constructor() {
		this.socket = null;
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
		if (this.socket) return;

		// io is loaded globally via /socket.io/socket.io.js
		if (typeof window.io !== 'function') {
			console.error('Socket.IO client library not loaded');
			return;
		}

		this.socket = window.io();

		this.socket.on('connect', () => {
			this.emitEvent('connect');
		});

		this.socket.on('disconnect', (reason) => {
			this.emitEvent('disconnect', reason);
		});

		this.socket.on('connect_error', (error) => {
			this.emitEvent('error', error);
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
		return new Promise((resolve, reject) => {
			if (!this.socket) this.connect();
			this.socket.emit('room:create', (response) => {
				if (response?.error) {
					reject(new Error(response.error));
				} else {
					resolve(response);
				}
			});
		});
	}

	joinRoom(code) {
		return new Promise((resolve, reject) => {
			if (!this.socket) this.connect();
			this.socket.emit('room:join', { code }, (response) => {
				if (response?.error) {
					reject(new Error(response.error));
				} else {
					resolve(response);
				}
			});
		});
	}

	sendSignal(type, payload) {
		if (!this.socket) return;
		this.socket.emit('rtc:signal', { type, payload });
	}

	leaveRoom() {
		if (!this.socket) return;
		this.socket.emit('room:leave');
	}

	disconnect() {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
	}
}
