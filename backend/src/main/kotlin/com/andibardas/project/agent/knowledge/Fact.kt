package com.andibardas.project.agent.knowledge

import org.apache.commons.math3.linear.RealVector

data class Fact(
    val content: String,
    val sourceUrl: String,
    val embedding: RealVector
)
