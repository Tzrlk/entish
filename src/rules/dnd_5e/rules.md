
A character's bonus is half their attribute score minus ten
```entish
bonus(character, attr, Floor( ( score - 10) / 2 )) :- attribute(character, attr, score).
```

The armor of a character is the sum of all equipped armor.
```entish
armor(character, Sum(armor)) :- armor(gear, armor) & equipped(character, gear).
```

Given a character, their load is the sum of the weights of gear they have equipped.
```entish
load(character, Sum(weight)) :- weight(gear, weight) & equipped(character, gear).
```

Characters are encumbered at 5 times their strength score, overloaded at 15 times.
```entish
tag(character, Encumbered) :- load(character, ?) > ( 5  * attribute(character, str) ).
tag(character, Overloaded) :- load(character, ?) > ( 15 * attribute(character, str) ).
```
