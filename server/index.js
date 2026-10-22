import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	createRoom,
	joinRoom,
	getOpponent,
	removePlayer,
	touchRoom,
	validatePlayerSession,
} from './rooms.js';

const app = express();
const httpServer = createServer(app);

const allowedOrigin = process.env.ALLOWED_ORIGIN || true;

const io = new Server(httpServer, {
	maxHttpBufferSize: 32 * 1024,
	cors: {
		origin: allowedOrigin,
		methods: ['GET', 'POST'],
	},
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

// Security: block access to server-side source files and git repository
app.use('/server', (_req, res) => {
	res.status(404).send('Not found');
});
app.use('/.git', (_req, res) => {
	res.status(404).send('Not found');
});

// Serve frontend static files
app.use(express.static(root));

io.on('connection', (socket) => {
	socket.data.room = null;
	socket.data.playerId = null;
	socket.data.playerNumber = null;
	socket.data.sessionToken = null;

	socket.on('room:create', async (ack = () => {}) => {
		if (socket.data.room) {
			return ack({ error: 'Already in an active room. Leave current room first.' });
		}

		try {
			const result = createRoom(socket.id);
			socket.data.room = result.code;
			socket.data.playerId = result.playerId; // 'player-1'
			socket.data.playerNumber = result.playerNumber; // 1
			socket.data.sessionToken = result.sessionToken;

			await socket.join(result.code);
			ack({
				code: result.code,
				playerId: result.playerId,
				playerNumber: result.playerNumber,
				participantId: result.participantId,
				sessionToken: result.sessionToken,
			});
		} catch (error) {
			ack({ error: error.message });
		}
	});

	socket.on('room:join', async (payload = {}, ack = () => {}) => {
		if (socket.data.room) {
			return ack({ error: 'Already in an active room. Leave current room first.' });
		}

		try {
			const result = joinRoom(payload.code, socket.id);
			socket.data.room = result.code;
			socket.data.playerId = result.playerId; // 'player-2'
			socket.data.playerNumber = result.playerNumber; // 2
			socket.data.sessionToken = result.sessionToken;

			await socket.join(result.code);
			ack({
				code: result.code,
				playerId: result.playerId,
				playerNumber: result.playerNumber,
				participantId: result.participantId,
				sessionToken: result.sessionToken,
				opponent: result.opponent,
			});

			// Notify host with verified guest identity
			socket.to(result.code).emit('room:peer-joined', {
				playerId: result.playerId,
				playerNumber: result.playerNumber,
				participantId: result.participantId,
			});
		} catch (error) {
			ack({ error: error.message });
		}
	});

	socket.on('rtc:signal', (message = {}) => {
		const room = socket.data.room;
		if (!room) return;

		const allowed = new Set(['offer', 'answer', 'ice']);
		if (!allowed.has(message.type)) return;

		// Bound message size to prevent oversized signaling payloads
		let serialized;
		try {
			serialized = JSON.stringify(message.payload);
		} catch {
			return;
		}
		if (serialized.length > 20_000) return;

		const opponentId = getOpponent(room, socket.id);
		if (!opponentId) return;

		touchRoom(room);
		io.to(opponentId).emit('rtc:signal', {
			type: message.type,
			payload: message.payload,
			fromPlayerId: socket.data.playerId,
		});
	});

	// Server-side fallback input relay with strict ownership validation
	socket.on('game:input', (payload = {}) => {
		const room = socket.data.room;
		if (!room) return;

		// Strict session ownership verification
		if (
			!payload ||
			payload.roomId !== room ||
			payload.playerId !== socket.data.playerId ||
			payload.sessionToken !== socket.data.sessionToken
		) {
			console.warn(`[Security] Rejected unauthorized input attempt from socket ${socket.id}`);
			return;
		}

		const opponentId = getOpponent(room, socket.id);
		if (!opponentId) return;

		io.to(opponentId).emit('game:input', {
			roomId: room,
			playerId: socket.data.playerId,
			sequence: payload.sequence,
			timestamp: payload.timestamp,
			input: payload.input,
		});
	});

	socket.on('room:leave', () => {
		leaveRoom(socket);
	});

	socket.on('disconnect', () => {
		leaveRoom(socket);
	});
});

function leaveRoom(socket) {
	const code = socket.data.room;
	if (!code) return;

	const opponentId = getOpponent(code, socket.id);
	socket.leave(code);
	const removedInfo = removePlayer(socket.id);

	if (opponentId) {
		io.to(opponentId).emit('room:peer-left', {
			playerId: socket.data.playerId,
		});
	}

	socket.data.room = null;
	socket.data.playerId = null;
	socket.data.playerNumber = null;
	socket.data.sessionToken = null;
}

const port = Number(process.env.PORT || 3000);
httpServer.listen(port, () => {
	console.log(`Street Fighter Online server running at http://localhost:${port}`);
});
