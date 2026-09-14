## Step 1. Check the current branch
Check the current Git branch and abort the entire process if there any uncommitted, unstaged or untracked files in the working directory. Tell the user to commit or stash changes before proceeding and DO NOT GO ANY FURTHER.

## Step 2. Parse the input arguments

From `$ARGUMENTS`, extract:
1. `feature_title`
	- A short, human readable title in Title Case
	- Example: "Card Component for Dashboard Stats"

2. `feature_slug`
	- A git safe slug.
	- Rules:
		- Lowercase
		- Kebab-Case
		- Only `a-z`,`0-9` and `-`
		- Replace spaces and punctuation with `-`
		- Collapse multiple `-` into one
		- Trim `-` from the start and End
		- Maximum length 40 characters
	- Example: `card-component` or `card-component-dashboard'.
	
3. `branch_name`
	- Format: `claude/feature/<feature_slug>`
	- Example: `claude/feature/card-component`.
	
If you cannot infer a sensible `feature-title` and `feature_slug`, ask the user to clarify instead of guessing.

## Step 3. Switch to a new Git branch
	
Before making any content, switch to a new Git branch using the `branch_name` derived from the `$ARGUMENTS`. If the branch name is already taken, then append a version number to it, e.g. `claude/features/card-component-01`	

## Step 4. Draft the spec content

Create a markdown document that Plan mode can use directly and save it in the _specs folder using the `feature_slug`. Use the exact structure as defined in the spec template file here: @_specs/template.md. Do not add technical implementation details such as code examples.

## Step 5. Create Git commit

Using a Conventional Commit syntax, create a commit for the code changes and submit that commit.

## Step 6. Final output to the user

After the file is saved, respond to the user with a short summary in the exact format:

Branch: <branch_name>  
Spec file: _specs/<feature_slug>.md  
Title: <feature_title>

Do not repeat the full spec in the chat output unless the user explicitly asks to see it. The main goal is to the save the spec file and report where it lives and what branch name to use.
