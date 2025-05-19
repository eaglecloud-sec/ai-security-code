const core = require('@actions/core');
const crypto = require('crypto');
const axios = require('axios');

class WebhookService {
    constructor(webhookUrl, webhookSecret, webhookHeaders = {}) {
        this.webhookUrl = webhookUrl;
        this.webhookSecret = webhookSecret;
        this.webhookHeaders = webhookHeaders;
    }

    /**
     * 生成 webhook 签名
     * @param {string} payload - 请求体
     * @returns {string} 签名
     */
    generateSignature(payload) {
        if (!this.webhookSecret) return null;
        return crypto
            .createHmac('sha256', this.webhookSecret)
            .update(payload)
            .digest('hex');
    }

    /**
     * 发送 webhook 请求
     * @param {Object} data - 要发送的数据
     * @returns {Promise<void>}
     */
    async sendWebhook(data) {
        if (!this.webhookUrl) {
            core.debug('No webhook URL provided, skipping webhook notification');
            return;
        }

        try {
            const payload = JSON.stringify(data);
            const headers = {
                'Content-Type': 'application/json',
                ...this.webhookHeaders
            };

            // 如果配置了密钥，添加签名
            if (this.webhookSecret) {
                const signature = this.generateSignature(payload);
                headers['X-Webhook-Signature'] = signature;
            }

            const response = await axios.post(this.webhookUrl, payload, { headers });
            
            if (response.status >= 200 && response.status < 300) {
                core.info('Webhook notification sent successfully');
            } else {
                core.warning(`Webhook notification sent with status ${response.status}`);
            }
        } catch (error) {
            core.error(`Failed to send webhook notification: ${error.message}`);
            if (error.response) {
                core.error(`Response status: ${error.response.status}`);
                core.error(`Response data: ${JSON.stringify(error.response.data)}`);
            }
        }
    }

    /**
     * 发送代码审查结果
     * @param {Object} reviewData - 审查数据
     * @param {string} reviewData.summary - 审查总结
     * @param {Array} reviewData.comments - 审查评论
     * @param {Object} prInfo - PR信息
     * @returns {Promise<void>}
     */
    async sendReviewResults(reviewData, prInfo) {
        const webhookData = {
            event: 'code_review',
            timestamp: new Date().toISOString(),
            repository: {
                owner: prInfo.owner,
                name: prInfo.repo,
                pull_request: prInfo.prNumber
            },
            review: {
                summary: reviewData.summary,
                comments: reviewData.comments,
                total_comments: reviewData.comments.length
            }
        };

        await this.sendWebhook(webhookData);
    }
}

module.exports = WebhookService; 