import Interpreter from "./entmoot";
import fs from "fs";
import marked from "marked";

test("parsing", () => {
  const interpreter = new Interpreter("seed");
  interpreter.parse(
    "∴ class(character, Barbarian) & wielding(character, Axe) ⊕ wielding(character, TwoHandedSword).",
    true
  );
  interpreter.parse("bonus(character, attr, floor((score-10)/2)) :- attribute(character, attr, score).", true);
});

test("load and exec rules for dungeon world", () => {
  const interpreter = new Interpreter("seed");
  const statements = fs
    .readdirSync("./src/rules/dungeon_world")
    .map((filename) => {
      if (filename.endsWith(".md")) {
        const markdown = new DOMParser().parseFromString(
          marked(fs.readFileSync("./src/rules/dungeon_world/" + filename).toString()),
          "text/html"
        );
        return Array.from(markdown.querySelectorAll("code.language-entish"))
          .map((node) => (node.textContent ? interpreter.parse(node.textContent, true) : []))
          .flat();
      }
      return [];
    })
    .flat();
  interpreter.load("class(Auric, Barbarian).");
  interpreter.load("carrying(Auric, DungeonRations, 5).");
  interpreter.load("wielding(Auric, Dagger).");
  interpreter.load("wielding(Auric, Axe).");
  statements.forEach((stmt) => interpreter.exec(stmt));
});
