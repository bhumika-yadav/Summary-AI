import * as vscode from 'vscode';

interface GeminiResponse {
	candidates: Array<{
		content: {
			parts: Array<{
				text: string;
			}>;
		};
	}>;
	//  handle potential blocks
	promptFeedback?: {
		blockReason: string;
	};
}
// System Prompt
const SYSTEM_PROMPT = `You are an expert Git documentation writer and senior software engineer. 
Your task is to generate concise, professional, and accurate documentation based on the user's input.
The input could be raw code, a 'git diff' output, or a high-level summary of changes.
You must strictly follow the user's requested documentation format.
For 'Conventional Commit', follow the format: <type>[optional scope]: <description>. Example: 'feat(api): add new user endpoint'
For 'Pull Request Description', provide a clear summary and describe the changes in bullet points.`;

export function activate(context: vscode.ExtensionContext) {

	let disposable = vscode.commands.registerCommand('summaryai.generate', async () => {


		// Get the 'gitdoc' configuration 
		const config = vscode.workspace.getConfiguration('summaryai');
		// Get the 'apiKey' value from that section
		const apiKey = config.get<string>('apiKey');

		// Check if the user has set their key
		if (!apiKey) {
			// If no key, show an error and stop.
			vscode.window.showErrorMessage('API Key not set. Please set "summaryai.apiKey" in your VS Code settings.');
			return; // 'return' stops the command
		}

		const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;

		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return; // Stop if there's no open file
		}

		// Get the part of the text that the user has highlighted
		const selection = editor.selection;
		const userInput = editor.document.getText(selection);

		if (!userInput) {
			// If they didn't highlight anything, show a warning and stop.
			vscode.window.showWarningMessage('Please select some code, diff, or text first.');
			return;
		}


		// Show a pop-up list of options
		const docType = await vscode.window.showQuickPick(
			[
				'Git Commit Message (Conventional Commit format)',
				'Pull Request Description (Template)',
				'Code Function Summary (Docstring)',
				'Release Notes Entry'
			],
			{
				placeHolder: 'What kind of documentation do you want to generate?',
			}
		);

		if (!docType) {
			return; // Stop if the user pressed 'Esc'
		}

		// Show a "Loading..." message in the bottom-right corner
		await vscode.window.withProgress({
			location: vscode.ProgressLocation.Notification,
			title: "Generating Git Documentation...",
			cancellable: false
		}, async (progress) => {

			try {
				// 1. Combine the user's text and the doc type into a final prompt
				const userQuery = `Generate a "${docType}" for the following changes:\n\n${userInput}`;

				// 2. Create the data payload to send to the AI
				// This must match what the Gemini API expects
				const payload = {
					contents: [{
						parts: [{ text: userQuery }]
					}],
					systemInstruction: {
						parts: [{ text: SYSTEM_PROMPT }]
					},
				};

				// Make the network request
				// 'await fetch' tells our code to wait for the AI's response
				const response = await fetch(GEMINI_API_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(payload) // Convert our data to a JSON string
				});

				if (!response.ok) {
					// If the AI gives an error (like "Invalid API Key"), show it
					const errorText = await response.text();
					throw new Error(`API Error: ${response.status} ${response.statusText}. Response: ${errorText}`);
				}

				// Get the JSON data from the response
				const result = await response.json() as GeminiResponse;

				// Dig into the response to find the generated text
				if (result.promptFeedback && result.promptFeedback.blockReason) {
					throw new Error(`Request was blocked: ${result.promptFeedback.blockReason}`);
				}

				// Dig into the response to find the generated text
				const candidate = result.candidates?.[0];
				const generatedText = candidate?.content?.parts?.[0]?.text;

				if (generatedText) {


					// Put the AI's text into the user's clipboard
					await vscode.env.clipboard.writeText(generatedText);

					// Show a success message
					vscode.window.showInformationMessage('Git documentation copied to clipboard!');
				} else {
					// This happens if the AI's response was empty or in a format we didn't expect
					throw new Error("Invalid response structure from API. The model might have returned empty content.");
				}

			} catch (error: any) {
				// If anything goes wrong (network error, API error, etc.), show it
				console.error("Error calling Gemini API:", error);
				vscode.window.showErrorMessage(`Failed to generate documentation: ${error.message}`);
			}
		});
	});

	// Add our new command to VS Code's list of commands
	context.subscriptions.push(disposable);
}

// This function is called when your extension is deactivated 
export function deactivate() { }