import { StreetFighterGame } from './StreetFighterGame.js';
import { initOnlineLobby } from './ui/OnlineLobby.js';

window.onload = () => {
	window.gameInstance = new StreetFighterGame();
	window.gameInstance.start();
	window.onlineLobby = initOnlineLobby();
};
