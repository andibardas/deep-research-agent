package com.andibardas.project

import com.andibardas.project.config.AgentProperties
import com.andibardas.project.config.ApiProperties
import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.runApplication

@SpringBootApplication
@EnableConfigurationProperties(value = [AgentProperties::class, ApiProperties::class])
class ResearchAgentApplication

fun main(args: Array<String>) {
	runApplication<ResearchAgentApplication>(*args)
}
