const mongoose = require("mongoose");

const resumeSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "user",
        required: true,
        unique: true
    },

    
    fileMeta: {

        originalName: {
            type: String,
            required: true
        },

        fileType: {
            type: String,
            enum: ["pdf", "docx"],
            required: true
        },

        fileSize: {
            type: Number,
            required: true
        },

        uploadedAt: {
            type: Date,
            default: Date.now
        },

        storagePath: {
            type: String,
            default: null
        }

    },

    parsedData: {
        rawText: { type: String, default: "" },
        name: { type: String, default: "" },
        contact: {
            email: { type: String, default: "" },
            phone: { type: String, default: "" },
            linkedin: { type: String, default: "" },
            github: { type: String, default: "" }
        },
        skills: {
            languages: { type: [String], default: [] },
            frameworks: { type: [String], default: [] },
            databases: { type: [String], default: [] },
            tools: { type: [String], default: [] },
            concepts: { type: [String], default: [] },
            softSkills: { type: [String], default: [] }
        },
        education: {
            type: [Object],
            default: []
        },
        experience: {
            type: [Object],
            default: []
        },
        projects: {
            type: [Object],
            default: []
        },
        domain: { type: String, default: "" },
        aiEnhanced: { type: Boolean, default: false },
        enhancedSkills: { type: [String], default: [] },
        missingSkills: { type: [String], default: [] },
        experienceSummary: { type: String, default: "" },
        confidence: { type: Number, default: null },
        feedbackSummary: { type: String, default: "" },
        strengths: { type: [String], default: [] },
        issues: { type: [String], default: [] },
        recommendations: {
            shortTermAdvice: { type: [String], default: [] },
            longTermAdvice: { type: [String], default: [] },
            missingSkills: { type: [String], default: [] }
        },
        validation: {
            status: { type: String, default: "success" },
            issues: { type: [String], default: [] }
        }
    },
    inferredRole: {
        type: String,
        default: null
    },
    matchingMeta: {

        totalSkills: {
            type: Number,
            default: 0
        },

        experienceLevel: {
            type: String,
            enum: ["fresher", "junior", "mid", "senior"],
            default: "fresher"
        }

    },
    processingStatus: {
        type: String,
        enum: ["processing", "completed", "failed"],
        default: "processing"
    }

}, {
    timestamps: true
});

module.exports = mongoose.model("Resume", resumeSchema);
