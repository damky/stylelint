'use strict';

const path = require('path');
const stringWidth = require('string-width');
const table = require('table');
const { yellow, dim, underline, blue, red, green } = require('picocolors');

const MARGIN_WIDTHS = 9;

/**
 * @param {string} s
 * @returns {string}
 */
function nope(s) {
	return s;
}

const levelColors = {
	info: blue,
	warning: yellow,
	error: red,
	success: nope,
};

const symbols = {
	info: blue('ℹ'),
	warning: yellow('⚠'),
	error: red('✖'),
	success: green('✔'),
};

/**
 * @param {import('stylelint').LintResult[]} results
 * @returns {string}
 */
function deprecationsFormatter(results) {
	const allDeprecationWarnings = results.flatMap((result) => result.deprecations);

	if (allDeprecationWarnings.length === 0) {
		return '';
	}

	const seenText = new Set();

	return allDeprecationWarnings.reduce((output, warning) => {
		if (seenText.has(warning.text)) return output;

		seenText.add(warning.text);

		output += yellow('Deprecation Warning: ');
		output += warning.text;

		if (warning.reference) {
			output += dim(' See: ');
			output += dim(underline(warning.reference));
		}

		return `${output}\n`;
	}, '\n');
}

/**
 * @param {import('stylelint').LintResult[]} results
 * @return {string}
 */
function invalidOptionsFormatter(results) {
	const allInvalidOptionWarnings = results.flatMap((result) =>
		result.invalidOptionWarnings.map((warning) => warning.text),
	);
	const uniqueInvalidOptionWarnings = [...new Set(allInvalidOptionWarnings)];

	return uniqueInvalidOptionWarnings.reduce((output, warning) => {
		output += red('Invalid Option: ');
		output += warning;

		return `${output}\n`;
	}, '\n');
}

/**
 * @param {string} fromValue
 * @return {string}
 */
function logFrom(fromValue) {
	if (fromValue.startsWith('<')) return fromValue;

	return path.relative(process.cwd(), fromValue).split(path.sep).join('/');
}

/**
 * @param {{[k: number]: number}} columnWidths
 * @return {number}
 */
function getMessageWidth(columnWidths) {
	if (!process.stdout.isTTY) {
		return columnWidths[3];
	}

	const availableWidth = process.stdout.columns < 80 ? 80 : process.stdout.columns;
	const fullWidth = Object.values(columnWidths).reduce((a, b) => a + b);

	// If there is no reason to wrap the text, we won't align the last column to the right
	if (availableWidth > fullWidth + MARGIN_WIDTHS) {
		return columnWidths[3];
	}

	return availableWidth - (fullWidth - columnWidths[3] + MARGIN_WIDTHS);
}

/**
 * @param {import('stylelint').Warning[]} messages
 * @param {string} source
 * @return {string}
 */
function formatter(messages, source) {
	if (!messages.length) return '';

	const orderedMessages = [...messages].sort((a, b) => {
		// positionless first
		if (!a.line && b.line) return -1;

		// positionless first
		if (a.line && !b.line) return 1;

		if (a.line < b.line) return -1;

		if (a.line > b.line) return 1;

		if (a.column < b.column) return -1;

		if (a.column > b.column) return 1;

		return 0;
	});

	/**
	 * Create a list of column widths, needed to calculate
	 * the size of the message column and if needed wrap it.
	 * @type {{[k: string]: number}}
	 */
	const columnWidths = { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1 };

	/**
	 * @param {[string, string, string, string, string]} columns
	 * @return {[string, string, string, string, string]}
	 */
	function calculateWidths(columns) {
		for (const [key, value] of Object.entries(columns)) {
			const normalisedValue = value ? value.toString() : value;

			columnWidths[key] = Math.max(columnWidths[key], stringWidth(normalisedValue));
		}

		return columns;
	}

	let output = '\n';

	if (source) {
		output += `${underline(logFrom(source))}\n`;
	}

	/**
	 * @param {import('stylelint').Warning} message
	 * @return {string}
	 */
	function formatMessageText(message) {
		let result = message.text;

		result = result
			// Remove all control characters (newline, tab and etc)
			.replace(/[\u0001-\u001A]+/g, ' ') // eslint-disable-line no-control-regex
			.replace(/\.$/, '');

		const ruleString = ` (${message.rule})`;

		if (result.endsWith(ruleString)) {
			result = result.slice(0, result.lastIndexOf(ruleString));
		}

		return result;
	}

	const cleanedMessages = orderedMessages.map((message) => {
		const { line, column, severity } = message;
		/**
		 * @type {[string, string, string, string, string]}
		 */
		const row = [
			line ? line.toString() : '',
			column ? column.toString() : '',
			symbols[severity] ? levelColors[severity](symbols[severity]) : severity,
			formatMessageText(message),
			dim(message.rule || ''),
		];

		calculateWidths(row);

		return row;
	});

	output += table
		.table(cleanedMessages, {
			border: table.getBorderCharacters('void'),
			columns: {
				0: { alignment: 'right', width: columnWidths[0], paddingRight: 0 },
				1: { alignment: 'left', width: columnWidths[1] },
				2: { alignment: 'center', width: columnWidths[2] },
				3: {
					alignment: 'left',
					width: getMessageWidth(columnWidths),
					wrapWord: getMessageWidth(columnWidths) > 1,
				},
				4: { alignment: 'left', width: columnWidths[4], paddingRight: 0 },
			},
			drawHorizontalLine: () => false,
		})
		.split('\n')
		.map(
			/**
			 * @param {string} el
			 * @returns {string}
			 */
			(el) => el.replace(/(\d+)\s+(\d+)/, (_m, p1, p2) => dim(`${p1}:${p2}`)),
		)
		.join('\n');

	return output;
}

/**
 * @type {import('stylelint').Formatter}
 */
module.exports = function (results) {
	let output = invalidOptionsFormatter(results);

	output += deprecationsFormatter(results);

	output = results.reduce((accum, result) => {
		// Treat parseErrors as warnings
		if (result.parseErrors) {
			for (const error of result.parseErrors)
				result.warnings.push({
					line: error.line,
					column: error.column,
					rule: error.stylelintType,
					severity: 'error',
					text: `${error.text} (${error.stylelintType})`,
				});
		}

		accum += formatter(result.warnings, result.source || '');

		return accum;
	}, output);

	// Ensure consistent padding
	output = output.trim();

	if (output !== '') {
		output = `\n${output}\n\n`;
	}

	return output;
};
