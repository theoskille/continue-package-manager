# Package Manager Template

To build: `npm run build`

To test: `npm run test`

To run the add command: `npm run test:add -- <package>`

To run the install command: `npm run test:install`

## Process

# Attempt 1

Started with a very simple straightforward approach.

Recusivly built out the node_modules tree where every package had it's own node_modules

This worked but resulted in a very deep tree with duplicates and runtime was bad

# Attempt 2

Tried to write a function that took and InstallationPlan and then returned a flattened tree version of the plan. 

Complexity rose quickly so I scrapped and started over. 

This time I constructed a simple flat tree right from the start. Anything that could go in the root node_modules did, if there was a conflict, I simply nested that version in the package that needed it.

This worked A LOT better but still had several problems.

it just installed the first version it encountered at the root and the rest would go under other packages. 
We want the version that will satisfy the most to be at the root. 

# Attempt 3

I tried to write a version that would figure out the optimal version that satisfied the most reasons and put that at root.

I wrote a HIGHLY unoptimized version that made several passes on the tree and made an absurd amount of network calls. 

It did work though.

# Attempt 4

Created an optimized version that looked to put the most commonly used version at root.

- Added a metadata cache to reduce network calls on duplicate dependencies.
- Broke process down into seperate functions. 
- Create a dependencyGraph with just the info we need. use this instead of making network calls every time to traverse the tree.
- calculate the "optimal version" based on which one satisfies the most ranges
- Added unit tests to test a variety of situations
- Added visualizer to log what the plan would look like to help testing

# Attempt 5

Added json-lock file for reproducible installs



