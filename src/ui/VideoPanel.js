export class VideoPanel {
	constructor({ onToggleAudio, onLeaveRoom, onRematch }) {
		this.onToggleAudio = onToggleAudio;
		this.onLeaveRoom = onLeaveRoom;
		this.onRematch = onRematch;

		this.audioEnabled = false;

		this.toggleAudioBtn = document.getElementById('toggleAudio');
		this.toggleAudioBtnHud = document.getElementById('toggleAudioHud');
		this.leaveRoomBtn = document.getElementById('leaveRoom');
		this.rematchBtn = document.getElementById('rematchBtn');
		this.pingBadge = document.getElementById('pingBadge');
		this.mediaStatus = document.getElementById('mediaStatus');

		this.initListeners();
	}

	initListeners() {
		const handleAudioToggle = async () => {
			this.audioEnabled = !this.audioEnabled;
			try {
				await this.onToggleAudio?.(this.audioEnabled);
				this.updateButtons();
			} catch (err) {
				this.audioEnabled = !this.audioEnabled;
				this.showMediaStatus(`Microphone error: ${err.message}`, true);
			}
		};

		this.toggleAudioBtn?.addEventListener('click', handleAudioToggle);
		this.toggleAudioBtnHud?.addEventListener('click', handleAudioToggle);

		this.leaveRoomBtn?.addEventListener('click', () => {
			this.onLeaveRoom?.();
		});

		this.rematchBtn?.addEventListener('click', () => {
			this.onRematch?.();
		});
	}

	updateButtons() {
		const label = this.audioEnabled ? '🎙️ Mic: ON' : '🎙️ Mic: OFF';
		if (this.toggleAudioBtn) {
			this.toggleAudioBtn.textContent = label;
			this.toggleAudioBtn.classList.toggle('active', this.audioEnabled);
		}
		if (this.toggleAudioBtnHud) {
			this.toggleAudioBtnHud.textContent = label;
			this.toggleAudioBtnHud.classList.toggle('active', this.audioEnabled);
		}
	}

	showMediaStatus(message, isError = false) {
		if (this.mediaStatus) {
			this.mediaStatus.textContent = message;
			this.mediaStatus.style.color = isError ? '#ff4d4d' : '#4dff88';
			setTimeout(() => {
				if (this.mediaStatus.textContent === message) {
					this.mediaStatus.textContent = '';
				}
			}, 4000);
		}
	}

	setPing(pingMs) {
		if (this.pingBadge) {
			this.pingBadge.textContent = `${pingMs} ms`;
			if (pingMs < 60) {
				this.pingBadge.style.color = '#39ff14';
			} else if (pingMs < 120) {
				this.pingBadge.style.color = '#ffaa00';
			} else {
				this.pingBadge.style.color = '#ff3333';
			}
		}
	}

	show() {
		this.updateButtons();
	}

	hide() {
		this.audioEnabled = false;
		this.updateButtons();
		if (this.pingBadge) this.pingBadge.textContent = '-- ms';
	}
}
