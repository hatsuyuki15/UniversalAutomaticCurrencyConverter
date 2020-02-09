class Highlighter {
    constructor() {
        this.color = 'yellow';
    }

    setColor(color) {
        // Validate color input
        const div = document.createElement('div');
        div.style.backgroundColor = color;
        if (div.style.backgroundColor !== color) {
            return;
        }
    }

    getTextShadowStyle() {
        const color = this.color;
        const style =
            `${color}  2px 0px 2px, ` +
            `${color} -2px 0px 2px, ` +
            `${color}  4px 0px 4px, ` +
            `${color} -4px 0px 4px, ` +
            `${color}  6px 0px 6px, ` +
            `${color} -6px 0px 6px`;
        return style;
    }
}