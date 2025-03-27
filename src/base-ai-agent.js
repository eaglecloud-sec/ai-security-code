class BaseAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model) {
        this.apiKey = apiKey;
        this.fileContentGetter = fileContentGetter;
        this.fileCommentator = fileCommentator;
        this.model = model;
        this.fileCache = new Map();
        this.cacheLock = false;
    }

    getSystemPrompt() {
        return `你是一位专业的代码审查专家，正在作为自动化CI流程的一部分分析GitHub拉取请求。你必须独立工作，无需人工交互。请审查代码中的逻辑错误、bug和安全问题。所有回复必须使用中文。

审查重点：
- 实际的bug和逻辑错误（最高优先级）
- 安全漏洞（最高优先级）
- 拼写错误

请跳过以下内容（但可以在总结中提及）：
- 代码格式和风格偏好（最低优先级）
- 性能问题
- 代码可维护性问题
- 最佳实践建议

对于每个发现的问题：
1. 使用 get_file_content 工具获取额外上下文（如需要）
2. 使用 add_review_comment 工具添加具体、可操作的代码评论

"changedFiles" 对象包含PR中修改的文件信息：
- filename: 修改文件的路径
- status: 变更状态（新增、修改等）
- patch: 显示具体更改的差异
- additions: 新增行数
- deletions: 删除行数

你必须使用 get_file_content 工具来检查文件以确保全面审查。始终基于收到的内容进行检查和判断。

审查完成后，使用 mark_as_done 工具提交简要总结。总结应仅包含：
- 代码变更的简明概述
- 变更的整体质量评估
- 观察到的任何模式或重复问题
- 不要在总结中提问或请求更多信息
- 不要说"我看不到变更" - 使用工具获取你需要的任何内容

行号从1开始计数。不要评论琐碎问题或风格偏好。
保持简洁但全面的审查。
=> 已启用无误报模式。`;
    }

    handleError(error, message, throwError = true) {
        console.error(`${message}: ${error.message}`);
        if (throwError) {
            throw new Error(`${message}: ${error.message}`);
        }
    }

    async getFileContentWithCache(pathToFile, startLineNumber, endLineNumber) {
        try {
            const acquireLock = async () => {
                const timeout = 5000; // 5 seconds
                const start = Date.now();
                while (this.cacheLock) {
                    if (Date.now() - start > timeout) {
                        throw new Error("Timeout while waiting for cache lock");
                    }
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                this.cacheLock = true;
            };
            
            const releaseLock = () => {
                this.cacheLock = false;
            };
            
            await acquireLock();
            let content;
            
            try {
                if (!this.fileCache.has(pathToFile)) {
                    releaseLock();
                    content = await this.fileContentGetter(pathToFile);
                    await acquireLock();
                    this.fileCache.set(pathToFile, content);
                } else {
                    content = this.fileCache.get(pathToFile);
                }
            } finally {
                releaseLock();
            }
            
            const span = 20;
            const lines = content.split('\n');
            const startIndex = Math.max(0, startLineNumber - 1 - span);
            const endIndex = Math.min(lines.length, endLineNumber + span);
            const selectedLines = lines.slice(startIndex, endIndex);
            return `\`\`\`${pathToFile}\n${selectedLines.join('\n')}\n\`\`\``;
        } catch (error) {
            if (this.cacheLock) {
                this.cacheLock = false;
            }
            this.handleError(error, 'Error getting file content', true);
            return `Error getting file content: ${error.message}`;
        }
    }

    validateLineNumbers(startLineNumber, endLineNumber) {
        if (!Number.isInteger(startLineNumber) || startLineNumber < 1) {
            return "Error: Start line number must be a positive integer";
        }
        if (!Number.isInteger(endLineNumber) || endLineNumber < 1) {
            return "Error: End line number must be a positive integer";
        }
        if (startLineNumber > endLineNumber) {
            return "Error: Start line number cannot be greater than end line number";
        }
        return null;
    }

    async addReviewComment(fileName, startLineNumber, endLineNumber, foundErrorDescription, side = "RIGHT") {
        try {
            const validationError = this.validateLineNumbers(startLineNumber, endLineNumber);
            if (validationError) {
                this.handleError(new Error(validationError), 'Validation error', true);
                return validationError;
            }
            
            await this.fileCommentator(foundErrorDescription, fileName, side, startLineNumber, endLineNumber);
            return "Success! The review comment has been published.";
        } catch (error) {
            this.handleError(error, 'Error creating review comment', true);
            return `Error! Please ensure that the lines you specify for the comment are part of the DIFF! Error message: ${error.message}`;
        }
    }

    async doReview(changedFiles) {
        throw new Error("Method 'doReview' must be implemented by subclass");
    }

    async initialize() {
        throw new Error("Method 'initialize' must be implemented by subclass");
    }
}

module.exports = BaseAIAgent;
