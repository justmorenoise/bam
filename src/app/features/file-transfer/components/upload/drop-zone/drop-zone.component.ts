import { Component, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    selector: 'app-drop-zone',
    standalone: true,
    imports: [TranslateModule],
    templateUrl: './drop-zone.component.html',
})
export class DropZoneComponent {
    fileSelected = output<File>();

    isDragging = signal(false);

    onDragOver(event: DragEvent) {
        event.preventDefault();
        this.isDragging.set(true);
    }

    onDragLeave(event: DragEvent) {
        event.preventDefault();
        this.isDragging.set(false);
    }

    onDrop(event: DragEvent) {
        event.preventDefault();
        this.isDragging.set(false);

        const files = Array.from(event.dataTransfer?.files || []);
        if (files.length > 0) {
            this.fileSelected.emit(files[0]);
        }
    }

    onFileSelect(event: Event) {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files || []);
        if (files.length > 0) {
            this.fileSelected.emit(files[0]);
        }
    }
}