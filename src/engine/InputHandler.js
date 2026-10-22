import { CONTROLLER_DEADZONE, controls } from '../config/controls.js';
import { Control } from '../constants/controls.js';
import { FighterDirection } from '../constants/fighter.js';

const mappedButtons = new Set(
	controls.map(({ gamepad }) => Object.values(gamepad)).flat()
);
const heldGamepadButtons = [new Set(), new Set()];
const pressedGamepadButtons = [new Set(), new Set()];

const gamepadThumbstickAxes = [
	{
		x: 0,
		y: 0,
	},
	{
		x: 0,
		y: 0,
	},
];

const heldKeys = new Set();
const pressedKeys = new Set();
const pressedKeysControlHistory = [new Set(), new Set()];
const mappedKeys = controls
	.map(({ keyboard }) => Object.values(keyboard))
	.flat();

// Online Multiplayer state
let isOnline = false;
let localPlayerIndex = 0; // 0 for P1 (host), 1 for P2 (guest)

const emptyInputState = () => ({
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

// Remote player inputs (derived ONLY from validated network packets)
const remoteHeld = [emptyInputState(), emptyInputState()];
const remotePressed = [new Set(), new Set()];
const remotePressedControlHistory = [new Set(), new Set()];

// Mobile Touch inputs (applied ONLY to the local player on this device)
const touchHeld = emptyInputState();
const touchPressed = new Set();
const touchPressedControlHistory = new Set();

export const setTouchInput = (key, isDown) => {
	const wasDown = !!touchHeld[key];
	touchHeld[key] = !!isDown;
	if (!isDown && wasDown) {
		touchPressed.delete(key);
		touchPressedControlHistory.delete(key);
	}
};

export const clearAllInputs = () => {
	heldKeys.clear();
	pressedKeys.clear();
	pressedKeysControlHistory[0].clear();
	pressedKeysControlHistory[1].clear();
	heldGamepadButtons[0].clear();
	heldGamepadButtons[1].clear();
	pressedGamepadButtons[0].clear();
	pressedGamepadButtons[1].clear();
	for (const key of Object.keys(touchHeld)) {
		touchHeld[key] = false;
	}
	touchPressed.clear();
	touchPressedControlHistory.clear();
};

export const setOnlineMode = (enabled, playerIdx = 0) => {
	isOnline = enabled;
	localPlayerIndex = playerIdx;
	remoteHeld[0] = emptyInputState();
	remoteHeld[1] = emptyInputState();
	remotePressed[0].clear();
	remotePressed[1].clear();
	remotePressedControlHistory[0].clear();
	remotePressedControlHistory[1].clear();
	clearAllInputs();
};

export const getOnlineMode = () => ({
	isOnline,
	localPlayerIndex,
});

export const setRemoteInput = (id, input) => {
	if (!input) return;

	const held = remoteHeld[id];
	const actionKeys = [
		Control.LIGHT_PUNCH,
		Control.MEDIUM_PUNCH,
		Control.HEAVY_PUNCH,
		Control.LIGHT_KICK,
		Control.MEDIUM_KICK,
		Control.HEAVY_KICK,
		'special',
		'block',
	];

	for (const key of actionKeys) {
		const wasHeld = held[key];
		const isNowHeld = !!input[key];
		if (!isNowHeld && wasHeld) {
			remotePressed[id].delete(key);
			remotePressedControlHistory[id].delete(key);
		}
	}

	remoteHeld[id] = {
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
	};
};

const isLocalKeyHeld = (id, code) => {
	if (isOnline && id !== localPlayerIndex) {
		// Strict isolation: Local keys can NEVER affect remote opponent
		return false;
	}
	const primaryKey = controls[id].keyboard[code];
	if (heldKeys.has(primaryKey)) return true;
	if (isOnline) {
		// In online mode, allow local user to also use the alternative keyboard mapping
		const altKey = controls[1 - id].keyboard[code];
		if (heldKeys.has(altKey)) return true;
	}
	return false;
};

export const getLocalInputState = (id = localPlayerIndex) => {
	const touchPunch = touchHeld.lightPunch || touchHeld.mediumPunch || touchHeld.heavyPunch;
	const touchKick = touchHeld.lightKick || touchHeld.mediumKick || touchHeld.heavyKick;

	return {
		left: isLocalLeft(id),
		right: isLocalRight(id),
		up: isLocalUp(id),
		down: isLocalDown(id),
		lightPunch:
			touchHeld.lightPunch ||
			isLocalKeyHeld(id, Control.LIGHT_PUNCH) ||
			heldGamepadButtons[id].has(controls[id].gamepad[Control.LIGHT_PUNCH]),
		mediumPunch:
			touchHeld.mediumPunch ||
			isLocalKeyHeld(id, Control.MEDIUM_PUNCH) ||
			heldGamepadButtons[id].has(controls[id].gamepad[Control.MEDIUM_PUNCH]),
		heavyPunch:
			touchHeld.heavyPunch ||
			isLocalKeyHeld(id, Control.HEAVY_PUNCH) ||
			heldGamepadButtons[id].has(controls[id].gamepad[Control.HEAVY_PUNCH]),
		lightKick:
			touchHeld.lightKick ||
			isLocalKeyHeld(id, Control.LIGHT_KICK) ||
			heldGamepadButtons[id].has(controls[id].gamepad[Control.LIGHT_KICK]),
		mediumKick:
			touchHeld.mediumKick ||
			isLocalKeyHeld(id, Control.MEDIUM_KICK) ||
			heldGamepadButtons[id].has(controls[id].gamepad[Control.MEDIUM_KICK]),
		heavyKick:
			touchHeld.heavyKick ||
			isLocalKeyHeld(id, Control.HEAVY_KICK) ||
			heldGamepadButtons[id].has(controls[id].gamepad[Control.HEAVY_KICK]),
		special: !!touchHeld.special,
		block: !!touchHeld.block,
	};
};

const isButtonPressed = (id, code) => {
	if (isOnline && id !== localPlayerIndex) return false;
	if (
		heldGamepadButtons[id].has(code) &&
		!pressedGamepadButtons[id].has(code)
	) {
		pressedGamepadButtons[id].add(code);
		return true;
	}
	return false;
};

const isPressed = (code, altCode = null) => {
	if (heldKeys.has(code) && !pressedKeys.has(code)) {
		pressedKeys.add(code);
		return true;
	}
	if (altCode && heldKeys.has(altCode) && !pressedKeys.has(altCode)) {
		pressedKeys.add(altCode);
		return true;
	}
	return false;
};

const isPressedControlHistory = (id, code) => {
	if (isOnline && id !== localPlayerIndex) return false;

	const controlKeyId = controls[id].keyboard[code];
	const controlButtonId = controls[id].gamepad[code];
	const altKeyId = isOnline ? controls[1 - id].keyboard[code] : null;

	if (
		heldKeys.has(controlKeyId) &&
		!pressedKeysControlHistory[id].has(controlKeyId)
	) {
		pressedKeysControlHistory[id].add(controlKeyId);
		return true;
	} else if (
		altKeyId &&
		heldKeys.has(altKeyId) &&
		!pressedKeysControlHistory[id].has(altKeyId)
	) {
		pressedKeysControlHistory[id].add(altKeyId);
		return true;
	} else if (
		heldGamepadButtons[id].has(controlButtonId) &&
		!pressedKeysControlHistory[id].has(controlButtonId)
	) {
		pressedKeysControlHistory[id].add(controlButtonId);
		return true;
	}
	return false;
};

const handleKeyDown = (event) => {
	if (!mappedKeys.includes(event.code)) return;
	event.preventDefault();
	if (!heldKeys.has(event.code)) {
		heldKeys.add(event.code);
	}
};

const handleKeyUp = (event) => {
	if (!mappedKeys.includes(event.code)) return;
	event.preventDefault();
	if (heldKeys.has(event.code)) {
		heldKeys.delete(event.code);
		pressedKeys.delete(event.code);
		if (Object.values(controls[0].keyboard).includes(event.code)) {
			pressedKeysControlHistory[0].delete(event.code);
		}
		if (Object.values(controls[1].keyboard).includes(event.code)) {
			pressedKeysControlHistory[1].delete(event.code);
		}
	}
};

export const registerKeyboardEvents = () => {
	window.addEventListener('keydown', handleKeyDown);
	window.addEventListener('keyup', handleKeyUp);
};

const handleGamepadConnected = (event) => {
	const gamepad = event.gamepad;
	console.log(
		`gamepad named ${gamepad.id} connected for player ${gamepad.index + 1}`
	);
};

const handleGamepadDisconnected = (event) => {
	const gamepad = event.gamepad;
	console.log(
		`gamepad named ${gamepad.id} disconnected for player ${gamepad.index + 1}`
	);
};

const updateGamepadButtons = (gamePadIndex, gamePad) => {
	if (!gamePad || gamePadIndex > 1) return;
	gamePad.buttons.forEach((button, index) => {
		if (!mappedButtons.has(index)) return;
		if (button.pressed) {
			heldGamepadButtons[gamePadIndex].add(index);
		} else {
			heldGamepadButtons[gamePadIndex].delete(index);
			pressedGamepadButtons[gamePadIndex].delete(index);
			pressedKeysControlHistory[gamePadIndex].delete(index);
		}
	});
};

const updateGamepadAxes = (gamePadIndex, gamePad) => {
	if (!gamePad || gamePadIndex > 1) return;
	gamepadThumbstickAxes[gamePadIndex].x = gamePad.axes[0];
	gamepadThumbstickAxes[gamePadIndex].y = gamePad.axes[1];
};

export const updateGamePads = () => {
	const gamepadList = navigator.getGamepads();

	for (const [gamePadIndex, gamePad] of gamepadList.entries()) {
		if (gamePadIndex < 2) {
			updateGamepadButtons(gamePadIndex, gamePad);
			updateGamepadAxes(gamePadIndex, gamePad);
		}
	}
};

export const registerGamepadEvents = () => {
	window.addEventListener('gamepadconnected', handleGamepadConnected);
	window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);
};

const isLocalLeft = (id) => {
	if (isOnline && id !== localPlayerIndex) return false;
	if (id === localPlayerIndex && touchHeld.left) return true;
	if (gamepadThumbstickAxes[id].x < -1 * CONTROLLER_DEADZONE) return true;
	return (
		isLocalKeyHeld(id, Control.LEFT) ||
		heldGamepadButtons[id].has(controls[id].gamepad[Control.LEFT])
	);
};

const isLocalRight = (id) => {
	if (isOnline && id !== localPlayerIndex) return false;
	if (id === localPlayerIndex && touchHeld.right) return true;
	if (gamepadThumbstickAxes[id].x > CONTROLLER_DEADZONE) return true;
	return (
		isLocalKeyHeld(id, Control.RIGHT) ||
		heldGamepadButtons[id].has(controls[id].gamepad[Control.RIGHT])
	);
};

const isLocalUp = (id) => {
	if (isOnline && id !== localPlayerIndex) return false;
	if (id === localPlayerIndex && touchHeld.up) return true;
	if (gamepadThumbstickAxes[id].y < -1 * CONTROLLER_DEADZONE) return true;
	return (
		isLocalKeyHeld(id, Control.UP) ||
		heldGamepadButtons[id].has(controls[id].gamepad[Control.UP])
	);
};

const isLocalDown = (id) => {
	if (isOnline && id !== localPlayerIndex) return false;
	if (id === localPlayerIndex && (touchHeld.down || touchHeld.block)) return true;
	if (gamepadThumbstickAxes[id].y > CONTROLLER_DEADZONE) return true;
	return (
		isLocalKeyHeld(id, Control.DOWN) ||
		heldGamepadButtons[id].has(controls[id].gamepad[Control.DOWN])
	);
};

export const isLeft = (id) => {
	if (isOnline && id !== localPlayerIndex) {
		return remoteHeld[id].left;
	}
	return isLocalLeft(id);
};

export const isUp = (id) => {
	if (isOnline && id !== localPlayerIndex) {
		return remoteHeld[id].up;
	}
	return isLocalUp(id);
};

export const isRight = (id) => {
	if (isOnline && id !== localPlayerIndex) {
		return remoteHeld[id].right;
	}
	return isLocalRight(id);
};

export const isDown = (id) => {
	if (isOnline && id !== localPlayerIndex) {
		return remoteHeld[id].down || remoteHeld[id].block;
	}
	return isLocalDown(id);
};

export const isForward = (id, direction) => {
	return direction === FighterDirection.RIGHT ? isRight(id) : isLeft(id);
};

export const isBackward = (id, direction) => {
	return direction === FighterDirection.RIGHT ? isLeft(id) : isRight(id);
};

export const isIdle = (id) =>
	isUp(id) || isDown(id) || isLeft(id) || isRight(id);

export const isKeyPressed = (id, code, forControlHistory) => {
	// Remote opponent in online mode: ONLY use validated remote state
	if (isOnline && id !== localPlayerIndex) {
		const isHeld = remoteHeld[id][code];
		const pressedSet = forControlHistory
			? remotePressedControlHistory[id]
			: remotePressed[id];

		if (isHeld && !pressedSet.has(code)) {
			pressedSet.add(code);
			return true;
		}
		return false;
	}

	// Local player touch input handling
	if (id === localPlayerIndex && touchHeld[code]) {
		const touchSet = forControlHistory ? touchPressedControlHistory : touchPressed;
		if (!touchSet.has(code)) {
			touchSet.add(code);
			return true;
		}
		return false;
	}

	if (forControlHistory) return isPressedControlHistory(id, code);

	const altKey = isOnline ? controls[1 - id].keyboard[code] : null;

	return (
		isButtonPressed(id, controls[id].gamepad[code]) ||
		isPressed(controls[id].keyboard[code], altKey)
	);
};

export const isLightPunch = (id, forControlHistory = false) => {
	return isKeyPressed(id, Control.LIGHT_PUNCH, forControlHistory);
};
export const isMediumPunch = (id, forControlHistory = false) => {
	return isKeyPressed(id, Control.MEDIUM_PUNCH, forControlHistory);
};
export const isHeavyPunch = (id, forControlHistory = false) => {
	return isKeyPressed(id, Control.HEAVY_PUNCH, forControlHistory);
};

export const isLightKick = (id, forControlHistory = false) => {
	return isKeyPressed(id, Control.LIGHT_KICK, forControlHistory);
};
export const isMediumKick = (id, forControlHistory = false) => {
	return isKeyPressed(id, Control.MEDIUM_KICK, forControlHistory);
};
export const isHeavyKick = (id, forControlHistory = false) => {
	return isKeyPressed(id, Control.HEAVY_KICK, forControlHistory);
};
