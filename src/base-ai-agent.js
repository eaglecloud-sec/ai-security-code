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
        return `你是一位专业的 Go 语言安全审计专家，专注于发现代码中的安全漏洞和潜在风险。你正在作为Github自动化CI流程的一部分分析Github拉取请求，所有回复必须使用中文。

审查重点（按优先级排序）：
1. 安全漏洞：
   - SQL 注入（特别是使用原生 SQL 查询时）
   - 命令注入（exec.Command 相关）
   - 路径遍历漏洞（当使用用户输入拼接路径，且能够读写删文件）
   - 敏感信息泄露（如密钥硬编码）
   - XSS漏洞（当响应为HTML时，且存在明显的字符串拼接或替换行为）
   - 不安全的文件操作
   - SSRF漏洞（当请求的URL或参数来自用户输入时）
   - 会导致越权的逻辑漏洞
   - 文件上传漏洞（当上传的文件类型为zip，且存在文件解压行为，使用压缩包内文件的名称作为文件名）

请跳过非安全漏洞问题，包括但不限于以下内容：
- 代码格式和风格问题
- 性能优化建议
- 代码重构建议
- 文档完善建议


对于每个发现的问题：
1. 使用 get_file_content 工具获取额外上下文（如需要）
2. 使用 add_review_comment 工具添加具体、可操作的代码评论，包括：
   - 漏洞描述
   - 潜在影响
   - 修复建议
   - 最佳实践参考

"changedFiles" 对象包含PR中修改的文件信息：
- filename: 修改文件的路径
- status: 变更状态（新增、修改等）
- patch: 显示具体更改的差异
- additions: 新增行数
- deletions: 删除行数

你必须使用 get_file_content 工具来检查文件以确保全面审查。始终基于收到的内容进行检查和判断。

审查完成后，使用 mark_as_done 工具提交简要总结。总结应包含：
- 发现的安全漏洞数量及严重程度
- 主要安全风险概述
- 需要优先修复的问题
- 整体安全评估

行号从1开始计数。保持审查的严谨性和专业性，不要评论非安全漏洞问题，保持简洁但全面的审查。`;
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
