import { Stage } from "../stage/Stage";
import { createStageEnvironment } from "../stage/environment";
import { mount } from "./mount";

// Created outside React so StrictMode's double render can't spawn a second runtime.
mount(<Stage env={createStageEnvironment()} />);
