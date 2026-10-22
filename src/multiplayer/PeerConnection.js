export class PeerConnection {
	constructor({
		socket,
		signalingClient,
		remoteAudio,
		onData,
		onConnectionStateChange,
		onChannelStateChange,
	}) {
		this.signalingClient = signalingClient;
		this.socket = socket || signalingClient?.socket;
		this.remoteAudio = remoteAudio;
		this.onData = onData;
		this.onConnectionStateChange = onConnectionStateChange;
		this.onChannelStateChange = onChannelStateChange;

		this.localAudioStream = null;
		this.activeCall = null;
		this.closed = false;
		this.channel = null;
		this.isPeerJS = this.signalingClient?.mode === 'peerjs';

		if (this.isPeerJS) {
			this.channel = { readyState: 'open' };
			this.setupPeerJSEvents();
			return;
		}

		// Socket.IO Native WebRTC RTCPeerConnection fallback
		this.pendingIce = [];
		this.remoteDescriptionSet = false;
		this.handleSignal = this.handleSignal.bind(this);

		const iceServers = [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:stun1.l.google.com:19302' },
			{ urls: 'stun:stun2.l.google.com:19302' },
		];

		this.pc = new RTCPeerConnection({ iceServers });
		this.audioTransceiver = this.pc.addTransceiver('audio', { direction: 'sendrecv' });

		this.pc.onicecandidate = ({ candidate }) => {
			if (candidate) {
				this.signal('ice', candidate.toJSON());
			}
		};

		this.pc.ontrack = (event) => {
			if (event.track.kind === 'audio') {
				const stream = (event.streams && event.streams[0]) || new MediaStream([event.track]);
				this.playRemoteStream(stream);
			}
		};

		this.pc.onconnectionstatechange = () => {
			this.onConnectionStateChange?.(this.pc.connectionState);
		};

		this.pc.ondatachannel = (event) => {
			this.attachDataChannel(event.channel);
		};

		if (this.signalingClient) {
			this.signalingClient.on('signal', this.handleSignal);
		} else if (this.socket) {
			this.socket.on('rtc:signal', this.handleSignal);
		}
	}

	setupPeerJSEvents() {
		const attachConn = (conn) => {
			if (!conn) return;

			conn.on('data', (data) => {
				this.onData?.(data);
			});

			conn.on('close', () => {
				console.log('[PeerConnection] PeerJS channel closed');
				if (this.channel) this.channel.readyState = 'closed';
				this.onChannelStateChange?.('close');
				this.onConnectionStateChange?.('disconnected');
			});

			conn.on('error', (err) => {
				console.warn('[PeerConnection] PeerJS channel error:', err);
			});

			if (conn.open) {
				this.channel = { readyState: 'open' };
				setTimeout(() => {
					this.onChannelStateChange?.('open');
					this.onConnectionStateChange?.('connected');
				}, 50);
			} else {
				conn.on('open', () => {
					this.channel = { readyState: 'open' };
					this.onChannelStateChange?.('open');
					this.onConnectionStateChange?.('connected');
				});
			}
		};

		if (this.signalingClient?.activeConn) {
			attachConn(this.signalingClient.activeConn);
		}

		this.signalingClient?.on('activeConnReady', (conn) => {
			attachConn(conn);
		});

		// Handle incoming audio call
		if (this.signalingClient?.peer) {
			this.signalingClient.peer.on('call', (call) => {
				console.log('[PeerJS Audio] Incoming voice call received');
				this.activeCall = call;
				call.answer(this.localAudioStream || undefined);
				call.on('stream', (remoteStream) => {
					this.playRemoteStream(remoteStream);
				});
			});
		}
	}

	playRemoteStream(stream) {
		console.log('[WebRTC Audio] Remote audio stream received');
		if (this.remoteAudio) {
			this.remoteAudio.srcObject = stream;
			this.remoteAudio.muted = false;
			this.remoteAudio.volume = 1.0;
			this.remoteAudio.play().catch((err) => {
				console.warn('[WebRTC Audio] Autoplay pending user interaction:', err);
			});
		}
	}

	signal(type, payload) {
		if (this.signalingClient) {
			this.signalingClient.sendSignal(type, payload);
		} else if (this.socket) {
			this.socket.emit('rtc:signal', { type, payload });
		}
	}

	attachDataChannel(channel) {
		this.channel = channel;

		channel.onopen = () => {
			this.onChannelStateChange?.('open');
		};

		channel.onclose = () => {
			this.onChannelStateChange?.('close');
		};

		channel.onerror = (err) => {
			console.warn('WebRTC data channel error:', err);
		};

		channel.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);
				this.onData?.(message);
			} catch {
				console.warn('Invalid game data message received');
			}
		};
	}

	async startAsHost() {
		if (this.isPeerJS) {
			// In PeerJS, the connection is already direct P2P!
			this.channel = { readyState: 'open' };
			this.onChannelStateChange?.('open');
			this.onConnectionStateChange?.('connected');
			return;
		}

		const dataChannel = this.pc.createDataChannel('game-input', {
			ordered: false,
			maxRetransmits: 0,
		});
		this.attachDataChannel(dataChannel);

		const offer = await this.pc.createOffer();
		await this.pc.setLocalDescription(offer);
		this.signal('offer', this.pc.localDescription);
	}

	async handleSignal(message) {
		if (!message || this.closed || this.isPeerJS) return;

		try {
			if (message.type === 'offer') {
				await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
				this.remoteDescriptionSet = true;
				await this.flushIce();

				const answer = await this.pc.createAnswer();
				await this.pc.setLocalDescription(answer);
				this.signal('answer', this.pc.localDescription);
			} else if (message.type === 'answer') {
				await this.pc.setRemoteDescription(new RTCSessionDescription(message.payload));
				this.remoteDescriptionSet = true;
				await this.flushIce();
			} else if (message.type === 'ice') {
				if (this.remoteDescriptionSet) {
					await this.pc.addIceCandidate(new RTCIceCandidate(message.payload));
				} else {
					this.pendingIce.push(message.payload);
				}
			}
		} catch (error) {
			console.error('WebRTC signaling failed:', error);
		}
	}

	async flushIce() {
		for (const candidate of this.pendingIce) {
			try {
				await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
			} catch (err) {
				console.warn('Error adding buffered ICE candidate:', err);
			}
		}
		this.pendingIce = [];
	}

	send(message) {
		if (this.closed) return false;

		if (this.isPeerJS) {
			const conn = this.signalingClient?.activeConn;
			if (conn && conn.open) {
				try {
					conn.send(message);
					return true;
				} catch (err) {
					console.warn('[PeerJS] Failed to send message:', err);
					return false;
				}
			}
			return false;
		}

		if (this.channel?.readyState === 'open') {
			try {
				this.channel.send(JSON.stringify(message));
				return true;
			} catch (err) {
				console.warn('Failed to send message over data channel:', err);
				return false;
			}
		}
		return false;
	}

	async setAudio(enabled = false) {
		if (this.isPeerJS) {
			const oldStream = this.localAudioStream;
			if (!enabled) {
				if (this.activeCall) {
					try { this.activeCall.close(); } catch {}
					this.activeCall = null;
				}
				oldStream?.getTracks().forEach((track) => track.stop());
				this.localAudioStream = null;
				return false;
			}

			try {
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
					video: false,
				}).catch(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }));

				this.localAudioStream = stream;

				const targetPeerId = this.signalingClient?.targetPeerId;
				if (targetPeerId && this.signalingClient?.peer) {
					console.log('[PeerJS Audio] Calling remote peer for voice chat:', targetPeerId);
					const call = this.signalingClient.peer.call(targetPeerId, stream);
					this.activeCall = call;
					call.on('stream', (remoteStream) => {
						this.playRemoteStream(remoteStream);
					});
				}
				return true;
			} catch (err) {
				console.warn('[PeerJS Audio] Mic permission or stream error:', err);
				throw err;
			}
		}

		const oldStream = this.localAudioStream;
		const audioTransceiver = this.pc.getTransceivers().find(
			(t) => t.receiver.track.kind === 'audio' || t.sender.track?.kind === 'audio'
		);

		if (!enabled) {
			if (audioTransceiver?.sender) {
				await audioTransceiver.sender.replaceTrack(null);
			}
			oldStream?.getTracks().forEach((track) => track.stop());
			this.localAudioStream = null;
			return false;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
				},
				video: false,
			}).catch(() => navigator.mediaDevices.getUserMedia({ audio: true, video: false }));

			const audioTrack = stream.getAudioTracks()[0] ?? null;

			if (audioTransceiver?.sender) {
				audioTransceiver.direction = 'sendrecv';
				await audioTransceiver.sender.replaceTrack(audioTrack);
			} else {
				this.pc.addTrack(audioTrack, stream);
			}

			this.localAudioStream = stream;
			oldStream?.getTracks().forEach((track) => track.stop());
			return true;
		} catch (err) {
			console.warn('Microphone access denied or error:', err);
			throw err;
		}
	}

	close() {
		this.closed = true;
		if (this.activeCall) {
			try { this.activeCall.close(); } catch {}
			this.activeCall = null;
		}
		if (this.localAudioStream) {
			this.localAudioStream.getTracks().forEach((track) => track.stop());
			this.localAudioStream = null;
		}
		if (this.channel) {
			try { this.channel.close(); } catch {}
			this.channel = null;
		}
		if (this.pc) {
			try { this.pc.close(); } catch {}
			this.pc = null;
		}
	}
}
