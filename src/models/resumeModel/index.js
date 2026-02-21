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
        }

    },

    
    rawText: {
        type: String,
        required: true
    },

    
    parsedData: {

        skills: {
            type: [String],
            default: []
        },

        education: {
            type: [String],
            default: []
        },

        experience: {
            type: [String],
            default: []
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