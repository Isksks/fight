import { PeerConnection } from '../multiplayer/PeerConnection.js';
import { OnlineMatch } from '../multiplayer/OnlineMatch.js';
import { SignalingClient } from '../multiplayer/SignalingClient.js';
import { VideoPanel } from './VideoPanel.js';
import { TouchControls } from './TouchControls.js';
import { StartScene } from '../scenes/StartScene.js';

export function initOnlineLobby() {
	const signaling = new SignalingClient();
	signaling.connect();

	let peer = null;
	let onlineMatch = null;
	let playerNumber = null;
	let playerId = null;
	let roomCode = null;
	let sessionToken = null;

	const arcadeContainer = document.querySelector('.arcade-container');
	const statusEl = document.querySelector('#roomStatus');
	const codeInput = document.querySelector('#roomCode');
	const copyBtn = document.querySelector('#copyInvite');
	const createBtn = document.querySelector('#createRoom');
	const joinBtn = document.querySelector('#joinRoom');
	const remoteAudio = document.querySelector('#remoteAudio');
	const matchHud = document.querySelector('#matchHud');
	const matchStatusText = document.querySelector('#matchStatusText');
	const matchPingBadge = document.querySelector('#matchPingBadge');
	const menuBtn = document.querySelector('#menuBtn');
	const matchMenuDropdown = document.querySelector('#matchMenuDropdown');
	const leaveMatchBtn = document.querySelector('#leaveMatchBtn');
	const fsBtn = document.querySelector('#fullscreenToggle');
	const fsBtnHud = document.querySelector('#fullscreenToggleHud');
	const touchToggleBtn = document.querySelector('#touchToggleBtn');
	const touchToggleBtnHud = document.querySelector('#touchToggleBtnHud');

	// Initialize mobile touch controls
	const touchControls = new TouchControls();

	// Voice Chat (Mic only) Controller
	const voicePanel = new VideoPanel({
		onToggleAudio: async (audioEnabled) => {
			if (peer) {
				await peer.setAudio(audioEnabled);
			} else if (audioEnabled) {
				// Pre-request mic permission if clicked in lobby before match
				try {
					const testStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
					testStream.getTracks().forEach((t) => t.stop());
					setStatus('Microphone permission granted. Mic will activate in match.');
				} catch (err) {
					setStatus(`Microphone permission denied: ${err.message}`, true);
					throw err;
				}
			}
		},
		onLeaveRoom: () => {
			leaveCurrentRoom();
		},
		onRematch: () => {
			onlineMatch?.requestRematch();
		},
	});

	function setStatus(message, isError = false) {
		if (statusEl) {
			statusEl.textContent = message;
			statusEl.className = isError ? 'status-msg error' : 'status-msg info';
		}
		if (matchStatusText) {
			matchStatusText.textContent = message;
		}
	}

	function setInMatchUI(inMatch) {
		if (inMatch) {
			arcadeContainer?.classList.add('in-match');
			if (matchHud) {
				matchHud.hidden = false;
				matchHud.classList.add('visible');
			}
		} else {
			arcadeContainer?.classList.remove('in-match');
			if (matchHud) {
				matchHud.hidden = true;
				matchHud.classList.remove('visible');
			}
		}
	}

	// Explicitly ensure match HUD is hidden on initial load
	setInMatchUI(false);

	// Autoplay unlocker for remote audio on any user gesture
	const unlockAudio = () => {
		if (remoteAudio && remoteAudio.srcObject && remoteAudio.paused) {
			remoteAudio.play().catch(() => {});
		}
	};
	['click', 'touchstart', 'keydown'].forEach((evt) => {
		window.addEventListener(evt, unlockAudio, { passive: true });
	});

	function startPeer() {
		if (peer) {
			peer.close();
			peer = null;
		}

		peer = new PeerConnection({
			signalingClient: signaling,
			remoteAudio,
			onConnectionStateChange: (state) => {
				if (state === 'connected') {
					setStatus(`WebRTC voice & data connected!`);
				} else if (state === 'failed' || state === 'disconnected') {
					setStatus(`Opponent connection ${state}`, true);
				}
			},
			onChannelStateChange: (state) => {
				if (state === 'open') {
					setStatus(`Match live! You are ${playerId.toUpperCase()} (${playerNumber === 1 ? 'Ryu' : 'Ken'})`);
					startMatch();
				} else if (state === 'close') {
					setStatus(`Game data channel closed`);
					stopMatch();
				}
			},
		});

		// If user enabled mic in lobby, automatically start audio on peer connection
		if (voicePanel.audioEnabled) {
			peer.setAudio(true).catch((err) => {
				console.warn('Auto mic start error on peer:', err);
				voicePanel.audioEnabled = false;
				voicePanel.updateButtons();
				setStatus(`Microphone error: ${err.message}`, true);
			});
		}
	}

	function startMatch() {
		if (!peer || onlineMatch) return;

		onlineMatch = new OnlineMatch({
			peerConnection: peer,
			roomId: roomCode,
			playerId,
			playerNumber,
			sessionToken,
			onStatusChange: (status) => setStatus(status),
			onPingUpdate: (ping) => {
				voicePanel.setPing(ping);
				if (matchPingBadge) matchPingBadge.textContent = `${ping} ms`;
			},
			onSecurityAlert: (alert) => {
				setStatus(alert, true);
			},
		});

		onlineMatch.start();
		setInMatchUI(true);
	}

	function stopMatch() {
		if (onlineMatch) {
			onlineMatch.stop();
			onlineMatch = null;
		}
		setInMatchUI(false);
	}

	function leaveCurrentRoom() {
		signaling.leaveRoom();
		stopMatch();
		if (peer) {
			peer.close();
			peer = null;
		}
		roomCode = null;
		playerId = null;
		playerNumber = null;
		sessionToken = null;
		voicePanel.hide();
		if (copyBtn) copyBtn.hidden = true;
		if (codeInput) codeInput.value = '';
		if (matchMenuDropdown) matchMenuDropdown.hidden = true;
		setStatus('You left the match. Ready for local play or new room.');

		// Return to StartScene
		if (window.gameInstance) {
			window.gameInstance.changeScene(StartScene);
		}
	}

	// Fullscreen helper
	function toggleFullscreen() {
		if (!document.fullscreenElement) {
			document.documentElement.requestFullscreen?.().catch(() => {});
		} else {
			document.exitFullscreen?.().catch(() => {});
		}
	}
	fsBtn?.addEventListener('click', toggleFullscreen);
	fsBtnHud?.addEventListener('click', toggleFullscreen);

	// Touch toggle helper
	function toggleTouch() {
		const isNowOn = touchControls.toggle();
		const label = isNowOn ? '📱 Touch: ON' : '📱 Touch: OFF';
		if (touchToggleBtn) touchToggleBtn.textContent = label;
		if (touchToggleBtnHud) touchToggleBtnHud.textContent = label;
	}
	touchToggleBtn?.addEventListener('click', toggleTouch);
	touchToggleBtnHud?.addEventListener('click', toggleTouch);

	// Menu button shows Leave Match option only
	menuBtn?.addEventListener('click', (e) => {
		e.stopPropagation();
		if (matchMenuDropdown) {
			matchMenuDropdown.hidden = !matchMenuDropdown.hidden;
		}
	});

	leaveMatchBtn?.addEventListener('click', (e) => {
		e.stopPropagation();
		if (matchMenuDropdown) {
			matchMenuDropdown.hidden = true;
		}
		leaveCurrentRoom();
	});

	// Close menu dropdown if clicking outside
	document.addEventListener('click', (e) => {
		if (matchMenuDropdown && !matchMenuDropdown.hidden && !e.target.closest('.hud-menu-wrapper')) {
			matchMenuDropdown.hidden = true;
		}
	});

	// Button listeners
	createBtn?.addEventListener('click', async () => {
		try {
			setStatus('Creating room...');
			const result = await signaling.createRoom();
			roomCode = result.code;
			playerId = result.playerId; // 'player-1'
			playerNumber = result.playerNumber; // 1
			sessionToken = result.sessionToken;
			codeInput.value = roomCode;

			if (copyBtn) copyBtn.hidden = false;
			voicePanel.show();
			setStatus(`Room ${roomCode} created. Share code with opponent!`);
			startPeer();
		} catch (err) {
			setStatus(`Failed to create room: ${err.message}`, true);
		}
	});

	joinBtn?.addEventListener('click', async () => {
		const code = codeInput.value.trim().toUpperCase();
		if (!code) {
			setStatus('Please enter a room code', true);
			return;
		}

		try {
			setStatus('Joining room...');
			const result = await signaling.joinRoom(code);
			roomCode = result.code;
			playerId = result.playerId; // 'player-2'
			playerNumber = result.playerNumber; // 2
			sessionToken = result.sessionToken;

			if (copyBtn) copyBtn.hidden = false;
			voicePanel.show();
			setStatus(`Joined room ${roomCode}. Connecting to host...`);
			startPeer();
		} catch (err) {
			setStatus(`Failed to join room: ${err.message}`, true);
		}
	});

	copyBtn?.addEventListener('click', async () => {
		if (!roomCode) return;
		const invite = `${location.origin}${location.pathname}?room=${roomCode}`;
		try {
			await navigator.clipboard.writeText(invite);
			const prevText = copyBtn.textContent;
			copyBtn.textContent = 'Copied!';
			setTimeout(() => {
				copyBtn.textContent = prevText;
			}, 2000);
			setStatus('Invitation link copied to clipboard!');
		} catch {
			setStatus(`Invite link: ${invite}`);
		}
	});

	// Socket.io signaling events
	signaling.on('connect', () => {
		setStatus('Connected to room server. Ready for multiplayer.');
	});

	signaling.on('disconnect', () => {
		setStatus('Disconnected from server.', true);
		stopMatch();
	});

	signaling.on('error', (err) => {
		setStatus(`Server error: ${err.message || 'unknown'}`, true);
	});

	signaling.on('peerJoined', async (data) => {
		if (playerNumber === 1 && peer) {
			setStatus('Opponent joined! Establishing WebRTC connection...');
			try {
				await peer.startAsHost();
			} catch (err) {
				setStatus(`Failed to initiate WebRTC: ${err.message}`, true);
			}
		}
	});

	signaling.on('peerLeft', () => {
		setStatus('Opponent left or disconnected.', true);
		stopMatch();
		if (peer) {
			peer.close();
			peer = null;
		}
		if (playerNumber === 1) {
			startPeer();
			setStatus(`Room ${roomCode}: waiting for new opponent...`);
		}
	});

	// Check URL param for pre-filled room code and auto-join
	const requestedRoom = new URLSearchParams(location.search).get('room');
	if (requestedRoom) {
		codeInput.value = requestedRoom.toUpperCase();
		setStatus(`Room code ${requestedRoom} detected. Auto-joining match...`);
		setTimeout(() => {
			joinBtn?.click();
		}, 400);
	}

	return {
		leaveCurrentRoom,
		getRoomCode: () => roomCode,
		getPlayerNumber: () => playerNumber,
		getPlayerId: () => playerId,
		touchControls,
		voicePanel,
	};
}
