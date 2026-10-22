import { Control } from '../constants/controls.js';
import { setTouchInput, clearAllInputs } from '../engine/InputHandler.js';

export class TouchControls {
	constructor() {
		this.container = document.getElementById('touchControlsContainer');
		this.dpadCenter = document.getElementById('dpadCenter');
		this.dpad = document.getElementById('virtualDpad');

		this.activePointers = new Map(); // pointerId -> action or 'dpad'
		this.dpadPointerId = null;

		this.enabled = false;
		this.init();
	}

	init() {
		if (!this.container) return;

		// Auto-enable if touch is detected or mobile screen
		const isTouchDevice =
			'ontouchstart' in window ||
			navigator.maxTouchPoints > 0 ||
			window.matchMedia('(pointer: coarse)').matches;

		if (isTouchDevice) {
			this.show();
		}

		this.setupDpad();
		this.setupActionButtons();
		this.setupWindowSafety();
	}

	setupDpad() {
		if (!this.dpad) return;

		const updateDpadFromPoint = (clientX, clientY) => {
			const rect = this.dpad.getBoundingClientRect();
			const centerX = rect.left + rect.width / 2;
			const centerY = rect.top + rect.height / 2;
			const dx = clientX - centerX;
			const dy = clientY - centerY;
			const distance = Math.hypot(dx, dy);

			// Center deadzone
			const deadzone = rect.width * 0.15;
			if (distance < deadzone) {
				setTouchInput('left', false);
				setTouchInput('right', false);
				setTouchInput('up', false);
				setTouchInput('down', false);
				this.updateDpadVisuals(false, false, false, false);
				return;
			}

			// Angle in radians (-PI to PI)
			const angle = Math.atan2(dy, dx);
			const deg = (angle * 180) / Math.PI;

			// Direction thresholds
			const isRight = deg >= -67.5 && deg <= 67.5;
			const isLeft = deg >= 112.5 || deg <= -112.5;
			const isDown = deg >= 22.5 && deg <= 157.5;
			const isUp = deg >= -157.5 && deg <= -22.5;

			setTouchInput('left', isLeft);
			setTouchInput('right', isRight);
			setTouchInput('up', isUp);
			setTouchInput('down', isDown);

			this.updateDpadVisuals(isUp, isDown, isLeft, isRight);
		};

		this.dpad.addEventListener('pointerdown', (e) => {
			e.preventDefault();
			this.dpad.setPointerCapture(e.pointerId);
			this.dpadPointerId = e.pointerId;
			this.activePointers.set(e.pointerId, 'dpad');
			this.triggerHaptic();
			updateDpadFromPoint(e.clientX, e.clientY);
		});

		this.dpad.addEventListener('pointermove', (e) => {
			if (this.dpadPointerId === e.pointerId) {
				e.preventDefault();
				updateDpadFromPoint(e.clientX, e.clientY);
			}
		});

		const releaseDpad = (e) => {
			if (this.dpadPointerId === e.pointerId) {
				e.preventDefault();
				this.dpadPointerId = null;
				this.activePointers.delete(e.pointerId);
				setTouchInput('left', false);
				setTouchInput('right', false);
				setTouchInput('up', false);
				setTouchInput('down', false);
				this.updateDpadVisuals(false, false, false, false);
			}
		};

		this.dpad.addEventListener('pointerup', releaseDpad);
		this.dpad.addEventListener('pointercancel', releaseDpad);
	}

	updateDpadVisuals(up, down, left, right) {
		document.getElementById('dpadBtn-up')?.classList.toggle('active', up);
		document.getElementById('dpadBtn-down')?.classList.toggle('active', down);
		document.getElementById('dpadBtn-left')?.classList.toggle('active', left);
		document.getElementById('dpadBtn-right')?.classList.toggle('active', right);
	}

	setupActionButtons() {
		const buttonMap = [
			{ id: 'btnLp', control: Control.LIGHT_PUNCH },
			{ id: 'btnMp', control: Control.MEDIUM_PUNCH },
			{ id: 'btnHp', control: Control.HEAVY_PUNCH },
			{ id: 'btnLk', control: Control.LIGHT_KICK },
			{ id: 'btnMk', control: Control.MEDIUM_KICK },
			{ id: 'btnHk', control: Control.HEAVY_KICK },
			{ id: 'btnSpecial', control: 'special' },
			{ id: 'btnBlock', control: 'block' },
		];

		for (const { id, control } of buttonMap) {
			const element = document.getElementById(id);
			if (!element) continue;

			element.addEventListener('pointerdown', (e) => {
				e.preventDefault();
				element.setPointerCapture(e.pointerId);
				this.activePointers.set(e.pointerId, control);
				element.classList.add('active');
				this.triggerHaptic();

				if (control === 'special') {
					this.triggerSpecialHadouken();
				} else {
					setTouchInput(control, true);
				}
			});

			const handleRelease = (e) => {
				if (this.activePointers.get(e.pointerId) === control) {
					e.preventDefault();
					this.activePointers.delete(e.pointerId);
					element.classList.remove('active');
					setTouchInput(control, false);
				}
			};

			element.addEventListener('pointerup', handleRelease);
			element.addEventListener('pointercancel', handleRelease);
		}
	}

	triggerSpecialHadouken() {
		// Programmatically trigger Hadouken sequence for mobile convenience
		setTouchInput('special', true);
		setTimeout(() => setTouchInput('special', false), 150);
	}

	triggerHaptic() {
		if (typeof navigator.vibrate === 'function') {
			try {
				navigator.vibrate(10);
			} catch {}
		}
	}

	setupWindowSafety() {
		window.addEventListener('blur', () => this.clearAll());
		document.addEventListener('visibilitychange', () => {
			if (document.hidden) this.clearAll();
		});
	}

	clearAll() {
		this.activePointers.clear();
		this.dpadPointerId = null;
		setTouchInput('left', false);
		setTouchInput('right', false);
		setTouchInput('up', false);
		setTouchInput('down', false);
		setTouchInput(Control.LIGHT_PUNCH, false);
		setTouchInput(Control.MEDIUM_PUNCH, false);
		setTouchInput(Control.HEAVY_PUNCH, false);
		setTouchInput(Control.LIGHT_KICK, false);
		setTouchInput(Control.MEDIUM_KICK, false);
		setTouchInput(Control.HEAVY_KICK, false);
		setTouchInput('special', false);
		setTouchInput('block', false);
		this.updateDpadVisuals(false, false, false, false);
		document.querySelectorAll('.touch-btn').forEach((b) => b.classList.remove('active'));
	}

	show() {
		this.enabled = true;
		if (this.container) {
			this.container.hidden = false;
			this.container.classList.add('visible');
		}
	}

	hide() {
		this.clearAll();
		this.enabled = false;
		if (this.container) {
			this.container.hidden = true;
			this.container.classList.remove('visible');
		}
	}

	toggle() {
		if (this.enabled) {
			this.hide();
		} else {
			this.show();
		}
		return this.enabled;
	}
}
