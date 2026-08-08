import { beforeEach, describe, expect, test } from 'bun:test';
import { useGroupDragDrop } from '../src/composables/useGroupDragDrop.js';

let drag;

beforeEach(() => {
    drag = useGroupDragDrop();
    drag.endDrag();
});

describe('group drag state', () => {
    test('rejects the dragged group and every descendant as cycle targets', () => {
        drag.startDrag({
            uuid: 'parent',
            children: [{ uuid: 'child', children: [{ uuid: 'grandchild' }] }],
        });

        expect(drag.draggingUuid.value).toBe('parent');
        expect(drag.isInvalidTarget('parent')).toBe(true);
        expect(drag.isInvalidTarget('child')).toBe(true);
        expect(drag.isInvalidTarget('grandchild')).toBe(true);
        expect(drag.isInvalidTarget('sibling')).toBe(false);
    });

    test('shares and clears the active drop target', () => {
        const anotherNode = useGroupDragDrop();

        drag.setDropTarget('target', 'before');
        expect(anotherNode.dropTarget.value).toEqual({
            uuid: 'target',
            position: 'before',
        });

        anotherNode.clearDropTarget();
        expect(drag.dropTarget.value).toBe(null);
    });

    test('ending a drag clears both the group and its target constraints', () => {
        drag.startDrag({ uuid: 'parent', children: [{ uuid: 'child' }] });
        drag.setDropTarget('sibling', 'inside');

        drag.endDrag();

        expect(drag.draggingUuid.value).toBe(null);
        expect(drag.dropTarget.value).toBe(null);
        expect(drag.isInvalidTarget('child')).toBe(false);
    });
});
