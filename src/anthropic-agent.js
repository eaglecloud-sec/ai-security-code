const { warning, info } = require("@actions/core");
const Anthropic = require("@anthropic-ai/sdk");
const BaseAIAgent = require("./base-ai-agent");

const c_max_completion_tokens = 8192;

class AnthropicAgent extends BaseAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model, baseURL = null) {
        super(apiKey, fileContentGetter, fileCommentator, model);
        
        if (baseURL == null || baseURL === undefined || baseURL.trim() === '') {
            info("使用默认 Anthropic API URL");
            this.anthropic = new Anthropic({ apiKey });
        } else {
            info(`使用自定义 baseUrl: ${baseURL}`);
            this.anthropic = new Anthropic({ apiKey, baseURL });
        }
    }

    async initialize() {
        return true;
    }

    async doReview(changedFiles) {
        let reviewSummary = '';
        const simpleChangedFiles = changedFiles.map(file => ({
            filename: file.filename,
            status: file.status,
            additions: file.additions,
            deletions: file.deletions,
            changes: file.changes,
            patch: file.patch
        }));

        try {
            const maxRetries = 3;
            const initialBackoff = 1000;

            for (let retries = 0; retries < maxRetries; retries++) {
                try {
                    reviewSummary = await this.processReview(simpleChangedFiles);
                    break;
                } catch (error) {
                    if (retries >= maxRetries - 1) {
                        this.handleError(error, 'Max retries reached for processReview');
                    }

                    const backoff = initialBackoff * Math.pow(2, retries) + Math.random() * 1000;
                    warning(`Retry ${retries + 1}/${maxRetries}: ${error.message}. Retrying in ${Math.round(backoff)}ms`);
                    await new Promise(resolve => setTimeout(resolve, backoff));
                }
            }
        } catch (error) {
            this.handleError(error, 'Error in code review process', false);
        }

        return reviewSummary;
    }

    /**
     * Apply cache control to message history
     * - Add cache_control to the latest message
     * - Remove cache_control from previous messages
     */
    applyCacheControl(messages) {
        if (!messages || messages.length === 0) return messages;

        const processedMessages = JSON.parse(JSON.stringify(messages));

        for (const message of processedMessages) {
            if (message.content && Array.isArray(message.content)) {
                for (const content of message.content) {
                    if (content && typeof content === 'object') {
                        delete content.cache_control;
                    }
                }
            }
        }

        const latestMessage = processedMessages[processedMessages.length - 1];
        if (latestMessage.content && Array.isArray(latestMessage.content)) {
            for (const content of latestMessage.content) {
                if (content && typeof content === 'object') {
                    content.cache_control = { type: "ephemeral" };
                }
            }
        }

        return processedMessages;
    }

    async processReview(changedFiles) {
        const reviewState = {
            summary: '',
            reviewedFiles: new Set(),
            commentsMade: 0,
            maxIterations: 142,
            iterationCount: 0,
            seenToolCalls: new Set(),
            processedFiles: new Set(),
            messageHistory: []
        };

        const tools = [
            {
                name: "get_file_content",
                description: "Retrieves file content for context",
                input_schema: {
                    type: "object",
                    properties: {
                        path_to_file: {
                            type: "string",
                            description: "The fully qualified path to the file"
                        },
                        start_line_number: {
                            type: "integer",
                            description: "The starting line from the file content to retrieve, counting from one"
                        },
                        end_line_number: {
                            type: "integer",
                            description: "The ending line from the file content to retrieve, counting from one"
                        }
                    },
                    required: ["path_to_file", "start_line_number", "end_line_number"]
                }
            },
            {
                name: "add_review_comment",
                description: "Adds a review comment to a specific range of lines in the pull request diff",
                input_schema: {
                    type: "object",
                    properties: {
                        file_name: {
                            type: "string",
                            description: "The relative path to the file that necessitates a comment"
                        },
                        start_line_number: {
                            type: "integer",
                            description: "The starting line number where the comment should begin from the diff hunk (start_line_number must be strictly greater than first diff hunk line number)"
                        },
                        end_line_number: {
                            type: "integer",
                            description: "The ending line number where the comment should end from the diff hunk (end_line_number must be strictly greater than start_line_number and strictly less than last diff hunk line number)"
                        },
                        found_error_description: {
                            type: "string",
                            description: "The review comment content"
                        },
                        side: {
                            type: "string",
                            description: "In a split diff view, the side of the diff that the pull request's changes appear on. Can be LEFT or RIGHT. Use LEFT only for deletions. Use RIGHT for additions/changes! For a multi-line comment, side represents whether the last line of the comment range is a deletion or addition. If unknown use 'Diff view options' from GitHub Help documentation or prefer RIGHT.",
                            enum: ["LEFT", "RIGHT"],
                            default: "RIGHT"
                        }
                    },
                    required: ["file_name", "start_line_number", "end_line_number", "found_error_description"]
                }
            },
            {
                name: "mark_as_done",
                description: "Marks the code review as completed and provides a brief summary of the changes",
                input_schema: {
                    type: "object",
                    properties: {
                        brief_summary: {
                            type: "string",
                            description: "A brief summary of the changes reviewed. Do not repeat comments. Focus on overall quality and any patterns observed."
                        }
                    },
                    required: ["brief_summary"]
                }
            }
        ];

        try {
            info("Starting code review with Anthropic API...");
            info(`Processing ${changedFiles.length} changed files...`);

            const initialUserMessage = {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `以下是需要审查的拉取请求中的变更文件（共${changedFiles.length}个文件）：${JSON.stringify(changedFiles, null, 2)}\n\n请审查这些文件中的问题，并在适当的地方提供具体的可操作建议。如果需要查看文件内容，请使用 get_file_content 工具。审查完成后，请使用 mark_as_done 工具提交简要总结。`
                    }
                ]
            };

            reviewState.messageHistory.push(initialUserMessage);

            const initialMessage = await this.anthropic.messages.create({
                model: this.model,
                max_tokens: c_max_completion_tokens,
                system: this.getSystemPrompt(),
                messages: this.applyCacheControl(reviewState.messageHistory),
                tools: tools
            });

            return await this.handleMessageResponse(initialMessage, tools, reviewState);
        } catch (error) {
            throw new Error(`Error during review: ${error.message}`);
        }
    }

    async handleMessageResponse(message, tools, reviewState) {
        if (!message || !message.content) {
            throw new Error("Invalid response from Anthropic API");
        }

        reviewState.iterationCount++;
        if (reviewState.iterationCount >= reviewState.maxIterations) {
            warning(`Reached maximum number of iterations (${reviewState.maxIterations}). Breaking potential infinite loop.`);
            if (!reviewState.summary) {
                return `Code review terminated early after ${reviewState.iterationCount} iterations. Processed ${reviewState.reviewedFiles.size} files with ${reviewState.commentsMade} comments.`;
            }
            return reviewState.summary;
        }

        reviewState.messageHistory.push({
            role: 'assistant',
            content: message.content
        });

        const toolCalls = message.content.filter(item => item.type === 'tool_use');

        if (toolCalls.length === 0) {
            const textContent = message.content.find(item => item.type === 'text');
            if (textContent) {
                if (!reviewState.summary) {
                    reviewState.summary = textContent.text;
                }
                return reviewState.summary;
            }
            if (!reviewState.summary) {
                return `Code review completed. Reviewed ${reviewState.reviewedFiles.size} files with ${reviewState.commentsMade} comments.`;
            }
            return reviewState.summary;
        }

        const toolResponses = await Promise.all(toolCalls.map(async (toolCall) => {
            try {
                let toolResponse;
                if (toolCall.name === 'get_file_content') {
                    const { path_to_file, start_line_number, end_line_number } = toolCall.input;
                    const fileRequestKey = `${path_to_file}-${start_line_number}-${end_line_number}`;
                    if (reviewState.seenToolCalls.has(fileRequestKey)) {
                        toolResponse = `Previously provided content for ${path_to_file} lines ${start_line_number}-${end_line_number}.`;
                    } else {
                        toolResponse = await this.getFileContentWithCache(path_to_file, start_line_number, end_line_number);
                        reviewState.seenToolCalls.add(fileRequestKey);
                        reviewState.processedFiles.add(path_to_file);
                    }
                } else if (toolCall.name === 'add_review_comment') {
                    const { file_name, start_line_number, end_line_number, found_error_description, side = "RIGHT" } = toolCall.input;
                    toolResponse = await this.addReviewComment(file_name, start_line_number, end_line_number, found_error_description, side);
                    reviewState.reviewedFiles.add(file_name);
                    reviewState.commentsMade++;
                } else if (toolCall.name === 'mark_as_done') {
                    reviewState.summary = toolCall.input.brief_summary;
                    return null;
                } else {
                    toolResponse = `Unknown tool: ${toolCall.name}`;
                }

                return {
                    type: 'tool_result',
                    tool_use_id: toolCall.id,
                    content: toolResponse || "Operation completed successfully"
                };
            } catch (error) {
                return {
                    type: 'tool_result',
                    tool_use_id: toolCall.id,
                    content: `Error: ${error.message}`,
                    is_error: true
                };
            }
        }));

        const validResponses = toolResponses.filter(response => response !== null);

        if (validResponses.length > 0) {
            reviewState.messageHistory.push({
                role: 'user',
                content: validResponses
            });
        }

        if (reviewState.summary) {
            return reviewState.summary;
        }

        const nextMessage = await this.anthropic.messages.create({
            model: this.model,
            max_tokens: c_max_completion_tokens,
            system: this.getSystemPrompt(),
            messages: this.applyCacheControl(reviewState.messageHistory),
            tools: tools
        });

        return await this.handleMessageResponse(nextMessage, tools, reviewState);
    }
}

module.exports = AnthropicAgent;
