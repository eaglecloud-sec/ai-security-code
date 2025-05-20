const OpenAIAgent = require("./openai-agent");
const core = require("@actions/core");

class GoogleAgent extends OpenAIAgent {
    constructor(apiKey, fileContentGetter, fileCommentator, model, baseURL = null) {
        const defaultGoogleURL = "https://generativelanguage.googleapis.com/v1beta/openai/";
        const apiBaseURL = baseURL && baseURL.trim() !== '' ? baseURL : defaultGoogleURL;
        
        if (baseURL && baseURL.trim() !== '') {
            core.info(`使用自定义 Google API URL: ${baseURL}`);
        } else {
            core.info(`使用默认 Google API URL: ${defaultGoogleURL}`);
        }
        
        super(apiKey, fileContentGetter, fileCommentator, model, apiBaseURL);
    }
}

module.exports = GoogleAgent;
