import { randomBytes } from 'node:crypto';

const rooms = new Map();
const attemptTracker = new Map(); // socketId or IP -> { count, resetTime }

const MAX_ROOM_AGE_MS = 60 * 60 * 1000; // 1 hour
const ABANDONED_EXPIRY_MS = 5 * 60 * 1000; // 5 mins if only 1 player and inactive
const RATE_LIMIT_WINDOW_MS = 10 * 1000; // 10 seconds
const MAX_ATTEMPTS_PER_WINDOW = 15;

function checkRateLimit(key) {
	const now = Date.now();
	let record = attemptTracker.get(key);
	if (!record || now > record.resetTime) {
		record = { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS };
		attemptTracker.set(key, record);
		return true;
	}
	if (record.count >= MAX_ATTEMPTS_PER_WINDOW) {
		return false;
	}
	record.count += 1;
	return true;
}

function newCode() {
	return randomBytes(5).toString('hex').toUpperCase();
}

function generateToken() {
	return randomBytes(16).toString('hex');
}

export function createRoom(socketId) {
	if (!checkRateLimit(socketId)) {
		throw new Error('Rate limit exceeded. Please wait a moment.');
	}

	let code;
	do {
		code = newCode();
	} while (rooms.has(code));

	const sessionToken = generateToken();
	const participantId = `p1-${randomBytes(4).toString('hex')}`;

	const player1 = {
		socketId,
		playerId: 'player-1',
		playerNumber: 1,
		participantId,
		sessionToken,
		joinedAt: Date.now(),
	};

	const room = {
		code,
		players: [player1],
		createdAt: Date.now(),
		lastActivity: Date.now(),
	};
	rooms.set(code, room);

	return {
		code,
		playerId: 'player-1',
		playerNumber: 1,
		participantId,
		sessionToken,
	};
}

export function joinRoom(code, socketId) {
	if (!checkRateLimit(socketId)) {
		throw new Error('Rate limit exceeded. Please wait a moment.');
	}

	const normalized = String(code || '')
		.trim()
		.toUpperCase();
	const room = rooms.get(normalized);

	if (!room) {
		throw new Error('Room not found or expired');
	}

	const existing = room.players.find((p) => p.socketId === socketId);
	if (existing) {
		throw new Error('Already joined this room');
	}

	if (room.players.length >= 2) {
		throw new Error('Room is full (max 2 players)');
	}

	const sessionToken = generateToken();
	const participantId = `p2-${randomBytes(4).toString('hex')}`;

	const player2 = {
		socketId,
		playerId: 'player-2',
		playerNumber: 2,
		participantId,
		sessionToken,
		joinedAt: Date.now(),
	};

	room.players.push(player2);
	room.lastActivity = Date.now();

	const hostPlayer = room.players[0];

	return {
		code: normalized,
		playerId: 'player-2',
		playerNumber: 2,
		participantId,
		sessionToken,
		opponent: {
			socketId: hostPlayer.socketId,
			playerId: hostPlayer.playerId,
			playerNumber: hostPlayer.playerNumber,
			participantId: hostPlayer.participantId,
		},
	};
}

export function validatePlayerSession(code, socketId, claimedPlayerId, sessionToken) {
	const room = rooms.get(code);
	if (!room) return false;

	const player = room.players.find((p) => p.socketId === socketId);
	if (!player) return false;

	if (player.playerId !== claimedPlayerId) return false;
	if (player.sessionToken !== sessionToken) return false;

	return true;
}

export function getPlayerBySocket(socketId) {
	for (const [code, room] of rooms) {
		const player = room.players.find((p) => p.socketId === socketId);
		if (player) {
			return { code, player };
		}
	}
	return null;
}

export function getOpponent(code, socketId) {
	const room = rooms.get(code);
	if (!room) return null;

	const opponent = room.players.find((p) => p.socketId !== socketId);
	return opponent ? opponent.socketId : null;
}

export function getRoom(code) {
	return rooms.get(code) || null;
}

export function touchRoom(code) {
	const room = rooms.get(code);
	if (room) {
		room.lastActivity = Date.now();
	}
}

export function removePlayer(socketId) {
	attemptTracker.delete(socketId);

	for (const [code, room] of rooms) {
		const playerIndex = room.players.findIndex((p) => p.socketId === socketId);
		if (playerIndex === -1) continue;

		const removed = room.players.splice(playerIndex, 1)[0];
		room.lastActivity = Date.now();

		if (room.players.length === 0) {
			rooms.delete(code);
		}

		return {
			code,
			removedPlayerId: removed.playerId,
			remainingPlayers: room.players,
		};
	}
	return null;
}

export function cleanupRooms() {
	const now = Date.now();
	for (const [code, room] of rooms) {
		if (room.players.length === 0) {
			rooms.delete(code);
		} else if (now - room.createdAt > MAX_ROOM_AGE_MS) {
			rooms.delete(code);
		} else if (
			room.players.length === 1 &&
			now - room.lastActivity > ABANDONED_EXPIRY_MS
		) {
			rooms.delete(code);
		}
	}
}

// Run cleanup every 2 minutes
setInterval(cleanupRooms, 2 * 60 * 1000);
