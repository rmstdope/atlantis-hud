What's new for you in Atlantis HUD (v0.14.0)
============================================

## What your units will hold and earn

- Recruits dilute a unit's skills once and everywhere, so a unit that buys men
  before producing no longer gets three different answers about what it will make
- A unit given men has its diluted skill read by the Items column and the Silver
  column too, so what it makes agrees with the warning about whether it can make it
- Food is credited with the upkeep the game gives it - grain, livestock, fish and
  meals cover 30 silver each, not 50 - so a unit is no longer shown as fed when it
  would still fall short
- A unit sailing away is capped by what the hex it arrives in actually yields,
  instead of being credited with everything its men could make
- Goods given to another faction's unit standing in your hex now leave your unit,
  and a gift to a unit number your report names nowhere changes nothing at all
  instead of charging you for it
- Men named in a gift to another faction stay where they are, with the reason on
  the order - the game refuses them, and you must give the whole unit instead
- TAKE FROM another faction's unit moves nothing and says why, instead of quietly
  crediting you with goods you will never receive
- A WITHDRAW in the Nexus is warned and draws nothing from your unclaimed silver,
  because the game does not allow withdrawing there

## Studying and teaching

- A mage ordered to study a magic skill that cannot advance is warned, and the
  warning names the prerequisite skills to raise first
- Study warnings know each race's own ceiling, so a unit is told which of its races
  cannot learn a skill any further rather than being offered progress it can never
  make
- Only as many mages as a building has study places count as sheltered by it, and
  the mages left over are warned that they are studying without facilities
- A unit that is not made up entirely of leaders is warned that its TEACH will be
  refused, and no longer looks like it spent its month
- TEACH NEW now finds the unit you formed this month and checks it like any other
  student, instead of skipping the order
- Teaching another faction's unit that your report shows in the hex is no longer
  reported as absent
- The oversubscribed-teaching warning says the teaching bonus is diluted, instead
  of wrongly suggesting students lose their own month of study

## Taxing, guarding and pillaging

- A unit ordered to TAX with no combat-ready men is warned, told what it lacks, and
  its Silver no longer promises income it cannot collect
- A GUARD 1 given to a unit that cannot tax is warned, and no longer hides the fact
  that the hex is left unguarded
- AVOID 1 now cancels a unit's guard, so you are warned when it leaves your hex
  unguarded
- A hex another faction guards now warns that PILLAGE will collect nothing, while
  TAX only may be blocked

## Fleets, movement and building

- Only units actually ordered to SAIL count as crew, so a fleet carried by a
  skilled passenger doing something else is now warned as undercrewed
- Wagons add carrying capacity only where you have horses to hitch them to; the
  rest count as weight
- A unit finishing a ship it carries is no longer told to get inside a structure
  or that it lacks the skill to build

## Writing orders

- An order with extra text after everything it needs is accepted, the way the game
  accepts it, instead of being marked as an error
- Reusing a FORM number in a hex now says the rules advise against it, instead of
  claiming the second order will be refused

## Your units list

- Another faction's combat skills seen in a battle report now fill its Skills cell
  and get a section of their own in the unit panel, each naming the turn it was seen
- Ctrl/Cmd-clicking and shift-clicking rows change only what is picked, leaving the
  highlighted row that drives the unit panel where it was

## Magic

- The study tree's branch cards run in a single column, top to bottom, like every
  other list in the app
