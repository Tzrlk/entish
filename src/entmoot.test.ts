import Interpreter from './entmoot';
import fs from 'fs';
const example = fs.readFileSync('./src/example.ent').toString();

test('can run the interpreter', () => {
	const interpreter = new Interpreter();
	interpreter.load(example);
});
