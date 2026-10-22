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
		this.pendingIce = [];
		this.remoteDescriptionSet = false;
		this.closed = false;
		this.channel = null;

		// Bind signal handler to instance
		this.handleSignal = this.handleSignal.bind(this);

		const iceServers = [
			{ urls: 'stun:stun.l.google.com:19302' },
			{ urls: 'stun:stun1.l.google.com:19302' },
			{ urls: 'stun:stun2.l.google.com:19302' },
		];

		this.pc = new RTCPeerConnection({ iceServers });

		// Pre-create Audio Transceiver for bidirectional voice chat
		this.audioTransceiver = this.pc.addTransceiver('audio', { direction: 'sendrecv' });

		this.pc.onicecandidate = ({ candidate }) => {
			if (candidate) {
				this.signal('ice', candidate.toJSON());
			}
		};

		// Remote audio track handler
		this.pc.ontrack = (event) => {
			console.log('[WebRTC Audio] Remote track received:', event.track.kind, event.track.id);

			if (event.track.kind === 'audio') {
				// Construct or use stream safely
				const stream =
					(event.streams && event.streams[0]) || new MediaStream([event.track]);

				if (this.remoteAudio) {
					this.remoteAudio.srcObject = stream;
					this.remoteAudio.muted = false;
					this.remoteAudio.volume = 1.0;
					this.remoteAudio.play().then(() => {
						console.log('[WebRTC Audio] Remote audio playback active');
					}).catch((err) => {
						console.warn('[WebRTC Audio] Autoplay pending user interaction:', err);
					});
				}

				event.track.onunmute = () => {
					console.log('[WebRTC Audio] Remote track unmuted, playing audio');
					if (this.remoteAudio) {
						this.remoteAudio.play().catch(() => {});
					}
				};

				event.track.onmute = () => {
					console.log('[WebRTC Audio] Remote track muted');
				};
			}
		};

		this.pc.onconnectionstatechange = () => {
			const state = this.pc.connectionState;
			console.log('WebRTC connection state:', state);
			this.onConnectionStateChange?.(state);
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
			console.log('WebRTC game data channel opened');
			this.onChannelStateChange?.('open');
		};

		channel.onclose = () => {
			console.log('WebRTC game data channel closed');
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
		// Host creates the data channel
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
		if (!message || this.closed) return;

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
		if (!this.channel || this.channel.readyState !== 'open') {
			return false;
		}
		try {
			this.channel.send(JSON.stringify(message));
			return true;
		} catch (err) {
			console.warn('Failed to send game message:', err);
			return false;
		}
	}

	getAudioTransceiver() {
		// Find transceiver that is active and negotiated (mid !== null)
		return (
			this.pc.getTransceivers().find(
				(t) =>
					t.mid !== null &&
					(t.receiver.track.kind === 'audio' || t.sender.track?.kind === 'audio')
			) ||
			this.pc.getTransceivers().find(
				(t) => t.receiver.track.kind === 'audio' || t.sender.track?.kind === 'audio'
			)
		);
	}

	// Microphone Voice Chat
	async setAudio(enabled = false) {
		const oldStream = this.localAudioStream;
		const audioTransceiver = this.getAudioTransceiver();

		if (!enabled) {
			if (audioTransceiver?.sender) {
				await audioTransceiver.sender.replaceTrack(null);
			}
			oldStream?.getTracks().forEach((track) => track.stop());
			this.localAudioStream = null;
			return false;
		}

		try {
			let stream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					audio: {
						echoCancellation: true,
						noiseSuppression: true,
						autoGainControl: true,
					},
					video: false,
				});
			} catch {
				// Fallback to basic audio constraint if enhanced constraints fail
				stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
					video: false,
				});
			}

			const audioTrack = stream.getAudioTracks()[0] ?? null;

			if (audioTransceiver?.sender) {
				audioTransceiver.direction = 'sendrecv';
				await audioTransceiver.sender.replaceTrack(audioTrack);
			} else {
				this.pc.addTrack(audioTrack, stream);
			}

			this.localAudioStream = stream;
			oldStream?.getTracks().forEach((track) => track.stop());
			console.log('[WebRTC Audio] Local microphone track active:', audioTrack?.label);
			return true;
		} catch (error) {
			console.error('Microphone permission or capture error:', error);
			throw error;
		}
	}

	close() {
		this.closed = true;

		if (this.signalingClient) {
			this.signalingClient.off('signal', this.handleSignal);
		} else if (this.socket) {
			this.socket.off('rtc:signal', this.handleSignal);
		}

		if (this.channel) {
			try {
				this.channel.close();
			} catch {}
			this.channel = null;
		}

		this.localAudioStream?.getTracks().forEach((track) => track.stop());
		this.localAudioStream = null;

		try {
			this.pc.close();
		} catch {}

		if (this.remoteAudio && this.remoteAudio.srcObject) {
			try {
				this.remoteAudio.srcObject.getTracks().forEach((track) => track.stop());
			} catch {}
			this.remoteAudio.srcObject = null;
		}
	}
}
