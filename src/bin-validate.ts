#!/usr/bin/env node
import { validateMain } from "./validate.js";

process.exitCode = await validateMain(process.argv.slice(2));
